// Read-only smoke check for a real native Firebase client after App Check initialization.
// Never logs response bodies, credentials, location data, or SDK error messages.
const shapes = {
  getHome: value => Array.isArray(value.courses),
  getMapData: value => Array.isArray(value.facilities),
  getMy: value => Object.prototype.hasOwnProperty.call(value, 'activeSession'),
  getSettings: value => Object.prototype.hasOwnProperty.call(value, 'consent'),
};
async function checkConnection(call, {authenticated = false} = {}) {
  const names = ['getHome', 'getMapData'];
  if (authenticated) names.push('getMy', 'getSettings');
  const checks = [];
  for (const name of names) {
    try {
      const value = await call(name, {});
      if (value && value.ok === false) {
        checks.push({name, ok:false, code:value.errorCode || 'DOMAIN_REJECTION'});
      } else if (!value || typeof value !== 'object' || !shapes[name](value)) {
        checks.push({name, ok:false, code:'INVALID_RESPONSE'});
      } else checks.push({name, ok:true});
    } catch (error) {
      checks.push({name, ok:false, code:typeof error?.code === 'string' ? error.code : 'CALL_FAILED'});
    }
  }
  return {ok:checks.every(check => check.ok), authenticated, checks};
}
module.exports = {checkConnection};
