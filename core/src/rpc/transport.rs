//! Bounded, bidirectional NDJSON subprocess transport. Nested calls share the outer deadline.
use crate::Fault;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{self, BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, Sender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
const MAX_MESSAGE: usize = 64 * 1024 * 1024;
const STDERR_LIMIT: usize = 64 * 1024;
type WriteTask = (Vec<u8>, Sender<Result<(), String>>);
pub trait Handler {
    fn handle(
        &mut self,
        transport: &mut Transport,
        method: &str,
        params: Value,
    ) -> Result<Value, Fault>;
}
pub struct NoHandler;
impl Handler for NoHandler {
    fn handle(&mut self, _: &mut Transport, method: &str, _: Value) -> Result<Value, Fault> {
        Err(Fault::unknown(format!("No handler for {method}")))
    }
}
pub struct Transport {
    process: Child,
    messages: Receiver<Result<String, String>>,
    writes: Option<Sender<WriteTask>>,
    readers: Vec<JoinHandle<()>>,
    stderr: Arc<Mutex<Vec<u8>>>,
    pub transcript: Vec<Value>,
    pub notifications: Vec<Value>,
    timeout: Duration,
    deadlines: Vec<Instant>,
    active: Vec<Value>,
    responses: HashMap<String, Value>,
    sequence: u64,
    closed: bool,
    record: bool,
}
fn protocol(message: impl Into<String>) -> Fault {
    Fault::defect(
        format!("JSON-RPC protocol violation: {}", message.into()),
        Value::Null,
    )
}
fn valid_id(id: &Value) -> bool {
    id.is_null() || id.is_string() || id.is_number()
}
impl Transport {
    pub fn spawn(argv: &[String], timeout: Duration, cwd: Option<&Path>) -> Result<Self, Fault> {
        Self::spawn_adapter(argv, timeout, cwd, false)
    }
    /// Framework adapters stream diagnostics and supply their own evidence.
    pub fn spawn_adapter(
        argv: &[String],
        timeout: Duration,
        cwd: Option<&Path>,
        adapter: bool,
    ) -> Result<Self, Fault> {
        if argv.is_empty() || timeout.is_zero() {
            return Err(Fault::unknown(
                "Supply a target executable and positive timeout",
            ));
        }
        let mut command = Command::new(&argv[0]);
        command
            .args(&argv[1..])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        let mut process = command
            .spawn()
            .map_err(|e| Fault::unknown(format!("Could not start JSON-RPC target: {e}")))?;
        let stdout = process.stdout.take().unwrap();
        let mut stdin = process.stdin.take().unwrap();
        let mut error_stream = process.stderr.take().unwrap();
        let (tx, messages) = mpsc::channel();
        let (writes, rx) = mpsc::channel::<WriteTask>();
        let reader = thread::spawn(move || {
            let mut input = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                match input
                    .by_ref()
                    .take((MAX_MESSAGE + 2) as u64)
                    .read_until(b'\n', &mut line)
                {
                    Ok(0) => {
                        let _ = tx.send(Err("Target exited before completing the request".into()));
                        break;
                    }
                    Ok(_) => {
                        let result = if line.len() > MAX_MESSAGE + 1 {
                            Err("Target message exceeds the size limit".into())
                        } else if line.last() != Some(&b'\n') {
                            Err("Target message is not newline terminated".into())
                        } else {
                            String::from_utf8(line).map_err(|e| format!("Invalid UTF-8: {e}"))
                        };
                        let failed = result.is_err();
                        if tx.send(result).is_err() || failed {
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e.to_string()));
                        break;
                    }
                }
            }
        });
        let writer = thread::spawn(move || {
            while let Ok((bytes, done)) = rx.recv() {
                let result = stdin
                    .write_all(&bytes)
                    .and_then(|_| stdin.flush())
                    .map_err(|e| e.to_string());
                let failed = result.is_err();
                let _ = done.send(result);
                if failed {
                    break;
                }
            }
        });
        let stderr = Arc::new(Mutex::new(Vec::new()));
        let buffer = stderr.clone();
        let error_reader = thread::spawn(move || {
            let mut chunk = [0; 4096];
            while let Ok(n) = error_stream.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                if adapter {
                    let _ = io::stderr().write_all(&chunk[..n]);
                }
                let mut b = buffer.lock().unwrap();
                b.extend_from_slice(&chunk[..n]);
                let excess = b.len().saturating_sub(STDERR_LIMIT);
                b.drain(..excess);
            }
        });
        Ok(Self {
            process,
            messages,
            writes: Some(writes),
            readers: vec![reader, writer, error_reader],
            stderr,
            transcript: vec![],
            notifications: vec![],
            timeout,
            deadlines: vec![],
            active: vec![],
            responses: HashMap::new(),
            sequence: 0,
            closed: false,
            record: !adapter,
        })
    }
    pub fn stderr(&self) -> String {
        String::from_utf8_lossy(&self.stderr.lock().unwrap()).into_owned()
    }
    pub fn exit_code(&mut self) -> Option<i32> {
        self.process
            .try_wait()
            .ok()
            .flatten()
            .map(|s| s.code().unwrap_or(-1))
    }
    pub fn wait_for_exit(&mut self) -> Result<(), Fault> {
        let deadline = Instant::now() + self.timeout;
        while self.exit_code().is_none() {
            if Instant::now() >= deadline {
                self.close();
                return Err(Fault::defect(
                    "The target acknowledged shutdown but did not exit",
                    Value::Null,
                ));
            }
            thread::sleep(Duration::from_millis(2));
        }
        Ok(())
    }
    fn remaining(&self) -> Result<Duration, Fault> {
        self.deadlines
            .last()
            .and_then(|d| d.checked_duration_since(Instant::now()))
            .ok_or_else(|| {
                Fault::unknown("JSON-RPC target did not respond before the request deadline")
            })
    }
    fn send(&mut self, raw: &str, message: Option<Value>) -> Result<(), Fault> {
        if self.closed {
            return Err(protocol("Target connection is closed"));
        }
        if raw.len() > MAX_MESSAGE {
            return Err(Fault::unknown("Outgoing message exceeds size limit"));
        }
        let mut entry = json!({"direction":"sent","raw":raw});
        if let Some(message) = message {
            entry["message"] = message;
        }
        if self.record {
            self.transcript.push(entry);
        }
        let (tx, rx) = mpsc::channel();
        let mut bytes = raw.as_bytes().to_vec();
        bytes.push(b'\n');
        self.writes
            .as_ref()
            .unwrap()
            .send((bytes, tx))
            .map_err(|_| protocol("Target stopped accepting input"))?;
        rx.recv_timeout(self.remaining()?)
            .map_err(|_| Fault::unknown("Target did not accept the request before its deadline"))?
            .map_err(protocol)
    }
    pub fn request<H: Handler>(
        &mut self,
        method: &str,
        params: Option<Value>,
        handler: &mut H,
    ) -> Result<Value, Fault> {
        self.sequence += 1;
        let id = json!(format!("testwalker/{}", self.sequence));
        let mut msg = json!({"jsonrpc":"2.0","id":id,"method":method});
        if let Some(params) = params {
            msg["params"] = params;
        }
        self.exchange(msg, id, handler)
    }
    pub fn exchange<H: Handler>(
        &mut self,
        message: Value,
        expected_id: Value,
        handler: &mut H,
    ) -> Result<Value, Fault> {
        self.exchange_raw(&message.to_string(), expected_id, handler)
    }
    pub fn exchange_raw<H: Handler>(
        &mut self,
        raw: &str,
        id: Value,
        handler: &mut H,
    ) -> Result<Value, Fault> {
        if raw.contains(['\r', '\n']) || !valid_id(&id) || self.active.contains(&id) {
            return Err(Fault::unknown(
                "Request must be a single line with an inactive JSON-RPC ID",
            ));
        }
        let deadline = Instant::now() + self.timeout;
        let deadline = self
            .deadlines
            .last()
            .map_or(deadline, |outer| deadline.min(*outer));
        self.deadlines.push(deadline);
        self.active.push(id.clone());
        let result = self.perform(raw, &id, handler);
        self.deadlines.pop();
        self.active.pop();
        if result.is_err() {
            self.close();
        }
        result
    }
    fn perform<H: Handler>(
        &mut self,
        raw: &str,
        id: &Value,
        handler: &mut H,
    ) -> Result<Value, Fault> {
        self.send(raw, serde_json::from_str(raw).ok())?;
        loop {
            if let Some(response) = self.responses.remove(&id.to_string()) {
                return Ok(response);
            }
            let raw = self
                .messages
                .recv_timeout(self.remaining()?)
                .map_err(|_| {
                    Fault::unknown("JSON-RPC target did not respond before the request deadline")
                })?
                .map_err(protocol)?;
            let message: Value = serde_json::from_str(&raw).map_err(|e| {
                if self.record {
                    self.transcript
                        .push(json!({"direction":"received","raw":raw}));
                }
                protocol(format!("Target returned invalid JSON: {e}"))
            })?;
            if self.record {
                self.transcript
                    .push(json!({"direction":"received","raw":raw.trim_end(),"message":message}));
            }
            if !message.is_object() || message["jsonrpc"] != "2.0" {
                return Err(protocol("Invalid JSON-RPC 2.0 envelope"));
            }
            if let Some(method) = message.get("method") {
                if !method.is_string()
                    || message.get("result").is_some()
                    || message.get("error").is_some()
                    || message
                        .get("params")
                        .is_some_and(|p| !p.is_object() && !p.is_array())
                {
                    return Err(protocol("Invalid callback envelope"));
                }
                let Some(callback_id) = message.get("id") else {
                    self.notifications.push(message);
                    continue;
                };
                if !valid_id(callback_id) {
                    return Err(protocol("Invalid callback ID"));
                }
                let response = match handler.handle(
                    self,
                    method.as_str().unwrap(),
                    message.get("params").cloned().unwrap_or(json!({})),
                ) {
                    Ok(result) => json!({"jsonrpc":"2.0","id":callback_id,"result":result}),
                    Err(error) if self.closed => return Err(error),
                    Err(error) => {
                        json!({"jsonrpc":"2.0","id":callback_id,"error":error.rpc()})
                    }
                };
                self.send(&response.to_string(), Some(response))?;
            } else {
                let response_id = message
                    .get("id")
                    .ok_or_else(|| protocol("Response has no ID"))?;
                if !valid_id(response_id)
                    || !self.active.contains(response_id)
                    || self.responses.contains_key(&response_id.to_string())
                {
                    return Err(protocol("Mismatched or duplicate response ID"));
                }
                if message.get("result").is_some() == message.get("error").is_some() {
                    return Err(protocol("Response requires exactly one of result or error"));
                }
                if let Some(error) = message.get("error")
                    && (!error["code"].is_i64() || !error["message"].is_string())
                {
                    return Err(protocol("Invalid error object"));
                }
                self.responses.insert(response_id.to_string(), message);
            }
        }
    }
    pub fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        // An adapter has already received target.close and returned its artifacts.
        // Close stdin so its normal main/finally can exit before resorting to kill.
        if !self.record {
            self.writes.take();
            let deadline = Instant::now() + Duration::from_secs(2);
            while self.process.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(2));
            }
        }
        if self.process.try_wait().ok().flatten().is_none() {
            let _ = self.process.kill();
        }
        let _ = self.process.wait();
        self.writes.take();
        // A descendant may inherit pipes: never block shutdown indefinitely joining it.
        for worker in self.readers.drain(..) {
            if worker.is_finished() {
                let _ = worker.join();
            }
        }
    }
}
impl Drop for Transport {
    fn drop(&mut self) {
        self.close();
    }
}
