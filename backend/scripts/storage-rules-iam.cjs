// Storage Rules의 firestore.get/exists에 필요한 전용 서비스 계정 권한.
// Firebase CLI는 --non-interactive 배포에서 이 권한의 확인·부여를 건너뛴다.
const ROLE = 'roles/firebaserules.firestoreServiceAgent';
function ensureStorageRulesBinding(policy, number) {
  if (!/^\d+$/.test(String(number))) throw Error('INVALID_PROJECT_NUMBER');
  const member = `serviceAccount:service-${number}@gcp-sa-firebasestorage.iam.gserviceaccount.com`;
  policy.bindings ||= [];
  let binding = policy.bindings.find(b => b.role === ROLE && !b.condition);
  if (!binding) { binding = { role: ROLE, members: [] }; policy.bindings.push(binding); }
  if (binding.members.includes(member)) return false;
  binding.members.push(member);
  return true;
}
module.exports = { ROLE, ensureStorageRulesBinding };
