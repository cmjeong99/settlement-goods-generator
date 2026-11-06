// Static hosting needs no API. The local Node server serves its own version of
// this module with capability flags only; API keys never enter browser assets.
export const runtime = Object.freeze({ mode: 'static', aiEnabled: false });
