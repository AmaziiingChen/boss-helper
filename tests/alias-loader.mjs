const sourceRoot = new URL('../src/', import.meta.url)

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const path = specifier.slice(2)
    const target = path.includes('.') ? path : `${path}/index.ts`
    return nextResolve(new URL(target, sourceRoot).href, context)
  }
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.mjs')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw error
  }
}
