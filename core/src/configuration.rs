//! Shared exploration configuration for native CLI and RPC clients.
use crate::{Fault, model::Model};
use serde_json::json;

pub fn configure(
    model: Model,
    generator: Option<String>,
    edges: Option<f64>,
    states: Option<f64>,
) -> Result<Model, Fault> {
    if generator.is_none() && edges.is_none() && states.is_none() {
        return Ok(model);
    }
    let mut document = model.document;
    let graph = &mut document["models"][0];
    for (key, value) in [("edges", edges), ("states", states)] {
        if let Some(value) = value {
            if !value.is_finite() || !(0.0..=100.0).contains(&value) {
                return Err(Fault::unknown("Coverage must be between 0 and 100"));
            }
            graph["properties"]["business"]["coverage"][key] = json!(value);
        }
    }
    let generator = generator.unwrap_or_else(|| "quick_random".into());
    let coverage = &graph["properties"]["business"]["coverage"];
    let expression = match generator.as_str() {
        "quick_random" | "random" | "weighted_random" | "shortest_all_paths" => format!(
            "{generator}(edge_coverage({}) and vertex_coverage({}))",
            coverage["edges"].as_f64().unwrap().ceil() as u64,
            coverage["states"].as_f64().unwrap().ceil() as u64
        ),
        "new_york_street_sweeper" => "new_york_street_sweeper()".into(),
        "predefined_path"
            if graph["predefinedPathEdgeIds"]
                .as_array()
                .is_some_and(|a| !a.is_empty()) =>
        {
            "predefined_path(predefined_path)".into()
        }
        expression if expression.contains('(') && expression.trim_end().ends_with(')') => {
            expression.into()
        }
        "a_star" => {
            return Err(Fault::unknown(
                "A* needs a target: a_star(reached_vertex(state_id))",
            ));
        }
        "predefined_path" => {
            return Err(Fault::unknown(
                "predefined_path needs predefinedPathEdgeIds in the model",
            ));
        }
        _ => {
            return Err(Fault::unknown(
                "Supply a GraphWalker generator name or complete native expression",
            ));
        }
    };
    graph["generator"] = json!(expression);
    Model::new(document)
}
