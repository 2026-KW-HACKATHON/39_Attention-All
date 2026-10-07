// 앱 문서 폴더의 작은 JSON 파일. 요청 ID·운동 큐·사진 작업처럼 앱 재시작 뒤에도 이어야 하는 상태만 둔다.
// 파일 이름에 UID를 넣어 계정마다 분리한다(다른 계정으로 로그인해도 읽지 않는다).
// 쓰기: 임시 파일에 다 쓴 뒤 본 파일로 옮긴다(쓰다 끊겨도 이전 내용이 남는다). 옮기는 사이에 끊기면 임시 파일에서 복구한다.
// 읽기: 파일이 없으면 기본값, 내용이 깨졌으면 기본값으로 덮지 않고 `.corrupt-시각`으로 옮겨 보관한 뒤 StoreError를 던진다.
// 읽기·쓰기 문제는 storeProblems에 남겨 화면에 알린다(빈 상태처럼 조용히 넘기지 않는다).
import { Directory, File, Paths } from 'expo-file-system';

export type StoreProblem = { file: string; kind: 'CORRUPT' | 'WRITE_FAILED'; at: number; keptAs?: string };
export class StoreError extends Error {
  problem: StoreProblem;
  constructor(problem: StoreProblem) {
    super('STORE_' + problem.kind);
    this.problem = problem;
  }
}

const problems = new Map<string, StoreProblem>();
const listeners = new Set<() => void>();
let snapshot: StoreProblem[] = [];
const changed = () => {
  snapshot = [...problems.values()];
  listeners.forEach(f => f());
};
export const subscribeStore = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
export const getStoreProblems = () => snapshot;
export const dismissStoreProblem = (file: string) => {
  if (problems.delete(file)) changed();
};
function report(p: StoreProblem) {
  problems.set(p.file, p);
  changed();
}

const file = (name: string) => new File(Paths.document, name);

export function readJson<T>(name: string, fallback: T): T {
  let f = file(name);
  if (!f.exists) {
    const tmp = file(name + '.tmp');
    if (!tmp.exists) return fallback;
    f = tmp; // 옮기기 직전에 끊긴 경우: 다 쓴 임시 파일
  }
  let text: string;
  try {
    text = f.textSync();
  } catch {
    const p: StoreProblem = { file: name, kind: 'CORRUPT', at: Date.now() };
    report(p);
    throw new StoreError(p);
  }
  try {
    const v = JSON.parse(text) as T;
    if (f.name !== name) f.moveSync(file(name), { overwrite: true });
    return v;
  } catch {
    // 손상된 파일은 지우지 않고 옆으로 옮겨 둔다(나중에 확인·복구할 수 있게).
    const keptAs = `${name}.corrupt-${Date.now()}`;
    try {
      f.moveSync(file(keptAs));
    } catch {}
    const p: StoreProblem = { file: name, kind: 'CORRUPT', at: Date.now(), keptAs };
    report(p);
    throw new StoreError(p);
  }
}

// 성공하면 true. 실패하면 이전 내용을 그대로 두고 문제를 알린다(호출한 쪽은 메모리 상태를 유지하고 다시 저장을 시도한다).
export function writeJson(name: string, value: unknown) {
  try {
    const tmp = file(name + '.tmp');
    if (tmp.exists) tmp.delete();
    tmp.create();
    tmp.write(JSON.stringify(value));
    tmp.moveSync(file(name), { overwrite: true });
    if (problems.get(name)?.kind === 'WRITE_FAILED') {
      problems.delete(name);
      changed();
    }
    return true;
  } catch {
    report({ file: name, kind: 'WRITE_FAILED', at: Date.now() });
    return false;
  }
}

export function removeFile(name: string) {
  for (const n of [name, name + '.tmp']) {
    const f = file(n);
    if (f.exists) f.delete();
  }
}

// 이름이 prefix로 시작하는 JSON 파일. 본 파일 없이 임시 파일만 남았어도 readJson으로 복구한다(손상 보관 파일 제외).
export function listJson(prefix: string) {
  const names = new Directory(Paths.document).list().map(e => e.name);
  return [...new Set(names
    .filter(n => n.startsWith(prefix) && (n.endsWith('.json') || n.endsWith('.json.tmp')))
    .map(n => n.endsWith('.tmp') ? n.slice(0, -4) : n))];
}
export const fileExists = (name: string) => file(name).exists;

// 증거 사진 보관 폴더(접수 확인 전까지 지우지 않는다)
export function evidenceFile(name: string) {
  const dir = new Directory(Paths.document, 'evidence');
  if (!dir.exists) dir.create();
  return new File(dir, name.endsWith('.jpg') ? name : name + '.jpg');
}
