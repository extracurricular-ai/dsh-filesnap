/**
 * CSS Modules are compiled by the client bundle's own lightningcss step, which
 * emits the hashed class map as the default export. This declaration is what
 * makes that import typecheck outside that build.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
