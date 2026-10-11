# Offline OpenRPC validation fixtures

These unmodified upstream release artifacts let the contract tests validate
without downloading schemas or allowing implicit network access.

| File | Official release | SHA-256 |
| --- | --- | --- |
| `open-rpc-meta-schema-1.14.9.json` | [OpenRPC meta-schema 1.14.9](https://github.com/open-rpc/meta-schema/releases/download/1.14.9/open-rpc-meta-schema.json) | `e5f534fb0dd9dd3598d26414e278a8c96e923ee7b54bef7009c499f4c71d0f82` |
| `json-schema-tools-meta-1.8.0.json` | [JSON Schema tools meta-schema 1.8.0](https://github.com/json-schema-tools/meta-schema/releases/download/1.8.0/schema.json) | `ebaa0daa2efb3f8247ae62f6fea63a11a73fa7f6c9663c7cc3f38430d147a366` |

Retrieved 2026-10-10. Both projects use Apache-2.0; the adjacent license files
are copied from each corresponding release tag.

The OpenRPC meta-schema package version is separate from the OpenRPC specification
version: package 1.14.9 supports specification 1.3.2 and earlier. The published
Testwalker documents use 1.3.2 so that the released schema can validate them
without modification. The raw upstream `schema.json` source is a build template
with a generated version field and is not a usable released meta-schema.

The official OpenRPC schema references `https://meta.json-schema.tools`.
Tests bind that URI and its trailing-slash variant to the pinned local artifact.
JSON Schema tools uses Draft 7 semantics; the registry selects those explicitly
because its `$schema` identifies its own custom meta-schema URI.
