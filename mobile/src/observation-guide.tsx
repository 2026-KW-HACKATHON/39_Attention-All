import { useState } from "react";
import { Micro, LinkBtn, SecTitle, Sheet, Txt } from "./ui";
export function ObservationGuide() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <LinkBtn label="관찰 정보 읽는 법" onPress={() => setOpen(true)} />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="관찰 정보 읽는 법"
      >
        <SecTitle first>그때 보인 모습을 기록해요</SecTitle>
        <Txt>
          관찰은 참여자가 현장에서 본 모습이에요. 수질 검사 결과나 안전 판정이
          아니며 기관에 자동 전달되지 않아요.
        </Txt>
        <SecTitle>사진과 간단 응답은 달라요</SecTitle>
        <Txt>
          사진은 촬영 당시 모습을 보여줘요. ‘지금도 보여요’ 응답은 같은 모습을
          봤다는 참여 기록이며 사진을 대신하지 않아요.
        </Txt>
        <SecTitle>지난 기록은 해결됐다는 뜻이 아니에요</SecTitle>
        <Txt>
          참여 기간이 끝났거나 최근 사진이 오래되면 지난 기록으로 표시해요. 해결
          여부를 판단한 결과가 아니에요.
        </Txt>
        <Micro>
          현장에서는 주변을 먼저 살피고 위험한 곳에 접근하지 마세요. 긴급 상황은
          이 앱의 제보 처리와 별개로 대응해 주세요.
        </Micro>
      </Sheet>
    </>
  );
}
