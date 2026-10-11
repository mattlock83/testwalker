//! Execute an arbitrary adapter executable over the public target protocol.
use crate::{
    Fault, Target,
    protocol::Peer,
    rpc::transport::{Handler, Transport},
};
use serde_json::{Value, json};
use std::{
    io::Cursor,
    path::{Path, PathBuf},
    time::Duration,
};

struct Services {
    peer: Peer<Cursor<Vec<u8>>, Vec<u8>>,
}
impl Handler for Services {
    fn handle(&mut self, _: &mut Transport, method: &str, params: Value) -> Result<Value, Fault> {
        // An adapter consumes framework services; it cannot launch a nested run,
        // replace the provider or take ownership of the execution lifecycle.
        if ![
            "core.info",
            "rpc.discover",
            "model.validate",
            "model.configure",
            "graph.setup",
            "graph.plan",
            "run.validate",
            "run.plan",
            "property.validate",
            "property.policy",
            "property.plan",
            "property.samples",
            "decision.ask",
            "decision.answer",
            "decision.post",
            "decision.stats",
            "decision.audit",
        ]
        .contains(&method)
        {
            return Err(Fault::unknown(format!(
                "Adapter cannot call framework method {method}"
            )));
        }
        self.peer.method(method, &params)
    }
}

pub struct ExecutableAdapter {
    transport: Option<Transport>,
    argv: Vec<String>,
    timeout: Duration,
    cwd: Option<PathBuf>,
    planned: Option<Value>,
    services: Services,
}
impl ExecutableAdapter {
    pub fn new(
        argv: &[String],
        timeout: Duration,
        cwd: Option<&Path>,
        decision: Option<&Value>,
    ) -> Result<Self, Fault> {
        let mut peer = Peer::new(Cursor::new(Vec::new()), Vec::new());
        if let Some(config) = decision {
            peer.method("decision.configure", config)?;
        }
        Ok(Self {
            transport: None,
            argv: argv.to_vec(),
            timeout,
            cwd: cwd.map(Path::to_path_buf),
            planned: None,
            services: Services { peer },
        })
    }
}
impl Target for ExecutableAdapter {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, Fault> {
        if method.starts_with("decision.") {
            return self.services.peer.method(method, &params);
        }
        if self.transport.is_none() {
            if method == "run.event" && params["type"] == "planned" {
                self.planned = Some(params);
                return Ok(json!({}));
            }
            if method == "target.close"
                || (method == "target.hook" && params["event"] == "after_run")
            {
                return Ok(json!({})); // Planning failed: no adapter was launched.
            }
            self.transport = Some(Transport::spawn_adapter(
                &self.argv,
                self.timeout,
                self.cwd.as_deref(),
                true,
            )?);
            if let Some(planned) = self.planned.take() {
                self.exchange("run.event", planned)?;
            }
        }
        self.exchange(method, params)
    }
    fn decision_report(&self) -> Option<Value> {
        self.services.peer.decision_report()
    }
    fn decision_count(&self) -> Option<usize> {
        self.services.peer.decision_count()
    }
}
impl ExecutableAdapter {
    fn exchange(&mut self, method: &str, params: Value) -> Result<Value, Fault> {
        let response = self
            .transport
            .as_mut()
            .unwrap()
            .request(method, Some(params), &mut self.services)
            .map_err(|mut error| {
                error.status = "INCONCLUSIVE".into();
                error
            })?;
        if let Some(error) = response.get("error") {
            let mut fault =
                serde_json::from_value::<Fault>(error["data"].clone()).unwrap_or_else(|_| {
                    Fault::unknown(error["message"].as_str().unwrap_or("Adapter error"))
                });
            if fault.status != "FAIL" {
                fault.status = "INCONCLUSIVE".into();
            }
            return Err(fault);
        }
        Ok(response.get("result").cloned().unwrap_or(json!({})))
    }
}
