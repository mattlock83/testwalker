//! Graph planning regressions belong to the native core, not the browser client.
use serde_json::json;
use testwalker_core::{configuration::configure, graph, model::Model};
fn model() -> Model {
    Model::new(serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap()).unwrap()
}
#[test]
fn native_fixture_routes_are_seeded_connected_and_cover_every_edge_and_state() {
    for text in [
        include_str!("fixtures/capacity.json"),
        include_str!("fixtures/service-workflow.json"),
    ] {
        let model = Model::new(serde_json::from_str(text).unwrap()).unwrap();
        let first = graph::path(&model, 42, 1000).unwrap();
        let second = graph::path(&model, 42, 1000).unwrap();
        assert_eq!(first, second);
        graph::validate_path(&model, &first).unwrap();
        for id in model.edges.keys().chain(model.states.keys()) {
            assert!(first.iter().any(|step| step["id"] == *id));
        }
    }
}
#[test]
fn imported_routes_cannot_spoof_identity_or_skip_connected_checkpoints() {
    let model = model();
    for route in [
        json!([]),
        json!([{"id":"accepted","kind":"state"}]),
        json!([{"id":"form","kind":"state"},{"id":"correct","kind":"edge"}]),
        json!([{"id":"form","kind":"state"},{"id":"submit","kind":"edge"}]),
        json!([{"id":"form","kind":"state"},{"id":"unknown","kind":"edge"}]),
    ] {
        assert!(graph::canonical_path(&model, route.as_array().unwrap()).is_err());
    }
    let route = json!([{"id":"form","kind":"state"},{"id":"submit","kind":"edge","targetVertexId":"rejected","name":"spoofed"},{"id":"accepted","kind":"state"}]);
    let canonical = graph::canonical_path(&model, route.as_array().unwrap()).unwrap();
    assert_eq!(canonical[1]["targetVertexId"], "accepted");
    assert_eq!(canonical[1]["name"], model.edges["submit"]["name"]);
}
#[test]
fn final_edges_receive_checkpoints_and_step_limits_remain_enforced() {
    let model = configure(
        model(),
        Some("predefined_path(predefined_path)".into()),
        None,
        None,
    )
    .unwrap();
    let mut document = model.document;
    document["models"][0]["predefinedPathEdgeIds"] = json!(["submit"]);
    let model = Model::new(document).unwrap();
    let path = graph::path(&model, 42, 100).unwrap();
    assert_eq!(path.last().unwrap()["id"], "accepted");
    assert_eq!(path.last().unwrap()["kind"], "state");
    assert!(
        graph::path(&model, 42, 1)
            .unwrap_err()
            .message
            .contains("max-steps")
    );
}
#[test]
fn runtime_generator_overrides_preserve_authored_model_and_native_modes() {
    let model = model();
    let changed = configure(model.clone(), Some("random".into()), Some(50.0), Some(70.0)).unwrap();
    assert_eq!(
        changed.business["coverage"],
        json!({"edges":50.0,"states":70.0})
    );
    assert_eq!(
        model.business["coverage"],
        json!({"edges":100,"states":100})
    );
    assert_ne!(changed.digest, model.digest);
    for name in ["random", "quick_random", "weighted_random"] {
        let configured =
            configure(model.clone(), Some(name.into()), Some(50.0), Some(60.0)).unwrap();
        assert!(!graph::path(&configured, 42, 1000).unwrap().is_empty());
    }
    for expression in [
        "a_star(reached_vertex(accepted))",
        "random(length(4)) a_star(reached_vertex(accepted))",
    ] {
        let configured =
            configure(model.clone(), Some(expression.into()), Some(0.0), Some(0.0)).unwrap();
        assert_eq!(
            graph::path(&configured, 42, 1000).unwrap().last().unwrap()["id"],
            "accepted"
        );
    }
    assert!(configure(model.clone(), Some("a_star".into()), None, None).is_err());
    assert!(configure(model, Some("predefined_path".into()), None, None).is_err());
}

#[test]
fn service_routes_cover_navigation_inputs_and_confirmation_scenarios() {
    let model =
        Model::new(serde_json::from_str(include_str!("fixtures/service-workflow.json")).unwrap())
            .unwrap();
    let route = graph::path(&model, 42, 1000).unwrap();
    for id in model.edges.keys().chain(model.states.keys()) {
        assert!(route.iter().any(|step| step["id"] == *id));
    }
    assert!(
        model
            .edges
            .values()
            .map(|e| e["weight"].to_string())
            .collect::<std::collections::HashSet<_>>()
            .len()
            >= 4
    );
    for edge in model
        .edges
        .values()
        .filter(|e| e["properties"]["business"].get("data set").is_some())
    {
        let setup = model
            .setup(edge["sourceVertexId"].as_str().unwrap())
            .unwrap();
        assert!(
            setup.is_empty() || setup.last().unwrap()["targetVertexId"] == edge["sourceVertexId"]
        );
    }
    let predefined = configure(
        model.clone(),
        Some("predefined_path".into()),
        Some(0.0),
        Some(0.0),
    )
    .unwrap();
    let route = graph::path(&predefined, 42, 1000).unwrap();
    let ids: Vec<_> = route
        .iter()
        .filter(|e| e["kind"] == "edge")
        .map(|e| e["id"].clone())
        .collect();
    assert_eq!(
        ids,
        *predefined.graph["predefinedPathEdgeIds"]
            .as_array()
            .unwrap()
    );
    for id in ["confirm_request", "confirm_cancellation", "correct_account"] {
        assert!(ids.contains(&json!(id)));
    }
    let sets = ids
        .iter()
        .filter_map(|id| {
            predefined.edges[id.as_str().unwrap()]["properties"]["business"]["data set"].as_str()
        })
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(sets, model.data_sets.keys().map(String::as_str).collect());
    for (expression, edges, states) in [
        ("weighted_random", 20.0, 50.0),
        ("a_star(reached_vertex(cancelled))", 0.0, 0.0),
        (
            "quick_random(edge_coverage(100)) a_star(reached_vertex(home))",
            100.0,
            100.0,
        ),
    ] {
        let configured = configure(
            model.clone(),
            Some(expression.into()),
            Some(edges),
            Some(states),
        )
        .unwrap();
        let route = graph::path(&configured, 42, 1000).unwrap();
        assert_eq!(route[0]["id"], "home");
        if expression.starts_with("a_star") {
            assert_eq!(route.last().unwrap()["id"], "cancelled");
        }
        if expression.ends_with("a_star(reached_vertex(home))") {
            assert_eq!(route.last().unwrap()["id"], "home");
        }
    }
}
