const { connect, project, number } = require('./cloud-client.cjs');
const { ROLE, ensureStorageRulesBinding } = require('./storage-rules-iam.cjs');
(async () => {
  const c = await connect(), crm = c('https://cloudresourcemanager.googleapis.com', 'v1');
  const policy = (await crm.post(`projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } })).body;
  const changed = ensureStorageRulesBinding(policy, number);
  if (changed) await crm.post(`projects/${project}:setIamPolicy`, { policy });
  const verified = (await crm.post(`projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } })).body;
  if (ensureStorageRulesBinding(verified, number)) throw Error('STORAGE_RULES_IAM_NOT_APPLIED');
  console.log(`${changed ? 'Granted' : 'Verified'} ${ROLE} for Firebase Storage service agent.`);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
