//! Native declarative JSON-RPC target, CLI and self-test execution.
pub mod contract;
pub mod target;
pub mod transport;
pub const SELF_MODEL: &str = include_str!("../../models/rpc-selftest.json");
