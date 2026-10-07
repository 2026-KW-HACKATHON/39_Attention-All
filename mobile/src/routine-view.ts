type State = { mine: string | null; accounts: number; slotsLeft: number };
export function routineView(state: State | null) {
  return {
    disabled: !!state?.mine,
    rewardLimit: !!state && state.slotsLeft <= 0,
    summary: state
      ? `${state.accounts}명 참여 · 오늘 정기 관찰 적립 ${state.slotsLeft}회 남음`
      : "",
  };
}
