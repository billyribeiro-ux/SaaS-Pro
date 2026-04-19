// (app) is fully dynamic — every route depends on `locals.user` and
// protected resources. Explicitly disable prerender so the root `auto`
// default doesn't even attempt it.
export const prerender = false;
