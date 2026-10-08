import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, BackHandler, View } from "react-native";
import {
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { createPreparation, type PreparationState } from "../run-ready";
import { preciseLoc } from "../location";
import { call } from "../firebase";
import { nearestPathDistance, OUTSIDE_START_WARNING, type PilotArea } from "../pilot-proximity";
import { getUid } from "../session";
import { getRun, startRun } from "../run";
import { START_TEXT } from "../start";
import { askNotificationPermission } from "../notify";
import { Btn, Micro, Notice, Num, Screen, SecTitle, Txt } from "../ui";
import { MODE_LABEL } from "../content";
import { color } from "../theme";
import { errorText } from "../core";
import { setWearPreparation } from "../wear";

export default function RunReady() {
  const router = useRouter(),
    navigation = useNavigation();
  const params = useLocalSearchParams<{ mode?: string; courseId?: string }>();
  const mode = params.mode === "WALK" ? "WALK" : "RUN",
    courseId = params.courseId ?? null;
  const [state, setState] = useState<PreparationState>({
    phase: "idle",
    count: 0,
    loc: null,
    error: null,
    uncertain: false,
  });
  const [prep] = useState(() =>
    createPreparation({
      autoStart: true,
      uid: getUid,
      now: Date.now,
      locate: preciseLoc,
      outsidePilot: async (loc) => {
        const pilot = await call<PilotArea>('getPilotData');
        const distance = nearestPathDistance(loc, pilot.paths);
        if (distance === null) throw new Error('PARTICIPATION_LOCATION_UNAVAILABLE');
        return distance > (pilot.participationRadiusM ?? 100);
      },
      confirmOutside: () => new Promise<boolean>(resolve => Alert.alert('우이천 바깥에서 운동 시작', OUTSIDE_START_WARNING, [
        { text: '취소', style: 'cancel', onPress: () => resolve(false) },
        { text: '운동 시작', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) })),
      start: (loc, uid, allowOutsidePilot) => startRun(mode, courseId, { loc, uid, allowOutsidePilot }),
      delay: () => new Promise<void>((r) => setTimeout(r, 1000)),
      changed: (s) => {
        setState(s);
        setWearPreparation({ phase: s.phase, count: s.count, outside: !!s.outside, error: s.error, mode });
      },
    }),
  );
  const focused = useIsFocused();
  useFocusEffect(
    useCallback(() => {
      const back = BackHandler.addEventListener(
        "hardwareBackPress",
        () => prep.state.phase === "starting",
      );
      return () => {
        back.remove();
      };
    }, [prep]),
  );
  usePreventRemove(state.phase === "starting", () => {});
  useEffect(() => {
    if (state.phase === "done" && focused) {
      router.replace("/run");
      void askNotificationPermission();
    }
  }, [state.phase, router, focused]);
  useEffect(() => {
    if (getRun()) {
      router.replace("/run");
      return;
    }
    void prep.prepare();
    return () => { prep.cancel(); setWearPreparation(null); };
  }, [prep, router]);
  // Replacing navigation subscriptions must not cancel an in-flight GPS request.
  // Only actual route departure, unmount or app background cancels preparation.
  useEffect(() => {
    const remove = navigation.addListener("beforeRemove", () => {
      if (prep.state.phase !== "starting" && prep.state.phase !== "done") prep.cancel();
    });
    const blur = navigation.addListener("blur", () => prep.blur());
    return () => { remove(); blur(); };
  }, [navigation, prep]);
  useEffect(() => {
    const app = AppState.addEventListener("change", (s) => prep.appStateChanged(s));
    return () => app.remove();
  }, [prep]);
  const close = () => {
    if (prep.cancel()) router.back();
  };
  const busy =
    state.phase === "locating" ||
    state.phase === "confirming" ||
    state.phase === "countdown" ||
    state.phase === "starting";
  return (
    <Screen title={`${MODE_LABEL[mode]} 준비`} onClose={close}>
      <SecTitle first>위치를 확인하고 시작해요</SecTitle>
      <Txt>
        준비하는 동안 운동 시간은 기록하지 않아요. 위치를 확인한 뒤 3초 후
        시작해요.
      </Txt>
      <View
        style={{ paddingVertical: 32, alignItems: "center", gap: 12 }}
        accessibilityLiveRegion="polite"
      >
        {state.phase === "countdown" ? (
          <Num s={80} c={color.deep}>
            {state.count}
          </Num>
        ) : null}
        <Txt w={700} s={22}>
          {state.phase === "locating"
            ? "현재 위치를 확인하고 있어요"
            : state.phase === "confirming"
              ? "시작 위치를 확인하고 있어요"
            : state.phase === "ready"
              ? "시작할 준비가 됐어요"
              : state.phase === "starting"
                ? "운동을 시작하고 있어요"
                : state.phase === "countdown"
                  ? "잠시 후 시작해요"
                  : state.phase === "cancelled"
                    ? "준비가 멈췄어요"
                    : state.phase === "error"
                      ? state.uncertain
                        ? "시작 여부를 확인하지 못했어요"
                        : "다시 확인해 주세요"
                      : ""}
        </Txt>
        {state.loc && state.phase === "ready" ? (
          <Micro>GPS 정확도 {Math.round(state.loc.accuracyM)}m</Micro>
        ) : null}
      </View>
      {state.error ? (
        <Notice
          kind="err"
          text={
            state.uncertain
              ? "서버에서 운동이 시작됐을 수 있어요. 연결을 확인하고 다시 준비해 주세요. 재시도하면 서버의 진행 중인 운동을 이어 받아요."
              : (START_TEXT[state.error] ??
                errorText({
                  ok: false,
                  errorCode: state.error,
                  details: {},
                  retryable: false,
                }))
          }
        />
      ) : null}
      {!busy && state.phase !== "ready" && state.phase !== "done" ? (
        <Btn
          kind="blue"
          label="다시 준비"
          onPress={() => void prep.prepare()}
        />
      ) : null}
      <Btn
        kind="ghost"
        label={state.phase === "starting" ? "시작 확인 중" : "취소"}
        disabled={state.phase === "starting"}
        onPress={close}
      />
      <Micro>
        정확한 위치 권한이 필요해요. 우이천 산책로 100m 밖에서도 운동할 수 있어요.
        제보·재확인은 100m 안으로 들어오면 활성화돼요.
      </Micro>
    </Screen>
  );
}
