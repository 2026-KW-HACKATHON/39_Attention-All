import { useEffect, useRef, useState } from "react";
import { AppState, BackHandler, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { createPreparation, type PreparationState } from "../run-ready";
import { preciseLoc } from "../location";
import { getUid } from "../session";
import { getRun, startRun } from "../run";
import { START_TEXT } from "../start";
import { askNotificationPermission } from "../notify";
import { Btn, Micro, Notice, Num, Screen, SecTitle, Txt } from "../ui";
import { MODE_LABEL } from "../content";
import { color } from "../theme";

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
  });
  const mounted = useRef(true);
  const [prep] = useState(() =>
    createPreparation({
      uid: getUid,
      now: Date.now,
      locate: preciseLoc,
      start: (loc, uid) => startRun(mode, courseId, { loc, uid }),
      delay: () => new Promise<void>((r) => setTimeout(r, 1000)),
      changed: setState,
    }),
  );
  useEffect(() => {
    mounted.current = true;
    if (getRun()) {
      router.replace("/run");
      return;
    }
    void prep.prepare();
    const back = BackHandler.addEventListener(
      "hardwareBackPress",
      () => prep.state.phase === "starting",
    );
    const remove = navigation.addListener("beforeRemove", (e) => {
      if (prep.state.phase === "starting") e.preventDefault();
      else prep.cancel();
    });
    const app = AppState.addEventListener("change", (s) => {
      if (
        s !== "active" &&
        prep.state.phase !== "starting" &&
        prep.state.phase !== "done"
      )
        prep.cancel();
    });
    return () => {
      mounted.current = false;
      prep.cancel();
      back.remove();
      remove();
      app.remove();
    };
  }, [navigation, prep, router]);
  const begin = async () => {
    const r = await prep.begin();
    if (r && mounted.current) {
      router.replace("/run");
      void askNotificationPermission();
    }
  };
  const close = () => {
    if (prep.cancel()) router.back();
  };
  const busy =
    state.phase === "locating" ||
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
            : state.phase === "ready"
              ? "시작할 준비가 됐어요"
              : state.phase === "starting"
                ? "운동을 시작하고 있어요"
                : state.phase === "countdown"
                  ? "잠시 후 시작해요"
                  : state.phase === "cancelled"
                    ? "준비가 멈췄어요"
                    : state.phase === "error"
                      ? "다시 확인해 주세요"
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
            START_TEXT[state.error] ??
            "시작하지 못했어요. 연결을 확인하고 다시 시도해 주세요."
          }
        />
      ) : null}
      {state.phase === "ready" ? (
        <Btn kind="blue" label="3초 후 시작" onPress={() => void begin()} />
      ) : null}
      {!busy && state.phase !== "ready" && state.phase !== "done" ? (
        <Btn
          kind="blue"
          label="위치 다시 확인"
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
        정확한 위치 권한이 필요해요. 우이천 파일럿 구간 밖에서는 서버가 시작을
        제한할 수 있어요.
      </Micro>
    </Screen>
  );
}
