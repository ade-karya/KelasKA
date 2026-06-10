/**
 * @kelaska/dsl — the pure, dependency-free contract keystone for the KelasKA SDK family.
 *
 * Dependency arrows (kept acyclic):
 *   @kelaska/dsl       -> (nothing)
 *   @kelaska/renderer  -> @kelaska/dsl
 *   @kelaska/importer  -> @kelaska/dsl
 *   @kelaska/exporter  -> @kelaska/dsl   (reserved, future)
 *
 * This package contains ONLY the spec: types, (future) JSON Schema, pure
 * validators / type-guards, and version/migration helpers. It must never gain
 * a runtime dependency on React, pptx, echarts, etc.
 */
export * from './slides';
export * from './guards';
export * from './version';
