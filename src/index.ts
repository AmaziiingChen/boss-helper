import type { HelperContext } from './composables/useHelper'

/** The BOSS page hosts data bindings only; UI belongs to the native side panel. */
export async function run<C extends HelperContext<C, T, S>, T, S>(ctx: HelperContext<C, T, S>) {
  await Promise.all([ctx.conf.confInit(), ctx.models.initModel()])
  await ctx.onMount()
}
