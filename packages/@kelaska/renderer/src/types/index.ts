// The slide object model is the canonical contract from @kelaska/dsl. The renderer
// no longer vendors its own copy; it re-exports the DSL types here so the public
// `@kelaska/renderer/types` surface stays intact.
export * from '@kelaska/dsl';
export * from './effects';
