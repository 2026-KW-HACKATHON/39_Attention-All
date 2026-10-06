// 워치 연결 네이티브 모듈(Android). 이 모듈이 없는 빌드(재빌드 전 개발 빌드·iOS)에서는 null이고, 워치 연결만 꺼진다.
import { requireOptionalNativeModule } from 'expo';

export type WearCommandEvent = { json: string; nodeId: string };
type Bridge = {
  setAccount(key: string | null): number;
  takePending(): string;
  isPhoneLocked(): boolean;
  publish(json: string): Promise<number>;
  ack(nodeId: string | null, json: string): Promise<void>;
  hasWatch(reachable: boolean): Promise<boolean>;
  diagnose?(reason: string): void; // 임시 진단(이전 네이티브 빌드에는 없음)(logcat UirunDiag, 디버그 빌드만)
  awaitAlertShown(exposureId: string, timeoutMs: number): Promise<boolean>;
  addListener(event: 'onCommand', fn: (e: WearCommandEvent) => void): { remove(): void };
};

export default requireOptionalNativeModule<Bridge>('UirunWearBridge');
