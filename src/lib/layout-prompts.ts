export const DEFAULT_LAYOUT_SYSTEM_PROMPT = `## Narrative Heuristics
- 가장 먼저 전달해야 할 핵심 메시지를 정하고, 그 메시지를 가장 빨리 이해시키는 섹션부터 배치하세요.
- 선택된 표들 사이의 관계가 하나의 이야기처럼 읽히도록 근거와 보조 맥락을 연결하세요.
- 모든 표를 동일 비중으로 나열하지 말고, 영향도가 큰 표와 보조 표를 구분하세요.

## Section Composition Guidance
- header 이후 본문 섹션 수는 보통 2~5개 사이에서 결정하세요.
- 본문은 chart-group 중심으로 구성하고, KPI 카드나 takeaway/note 박스는 만들지 마세요.
- 첫 본문 섹션은 가장 강한 메시지를 드러내는 chart-group으로 두는 편을 우선하세요.

## Chart Selection Heuristics
- 시계열/추세는 "line"을 우선 고려하세요.
- 항목 간 비교는 "bar" 또는 "stacked-bar"를 우선 고려하세요.
- 비중 비교는 범주 수가 적을 때 "donut" 또는 "pie"를 고려하세요.
- 지역 비교는 "map"을 고려하세요.
- dimensions 또는 metrics가 불명확하면 억지로 축 이름을 추정하지 마세요.

## Writing Style
- 제목과 설명은 데이터가 입증하는 결론을 드러내는 구체적인 문장으로 작성하세요.
- 모든 텍스트는 한국어 실무 톤으로 작성하세요.
- generic 라벨보다 데이터 의미가 드러나는 제목을 우선하세요.

## Geometry Guidance
- geometry(layout)는 확신이 있을 때만 채우세요.
- 채우는 경우 좌표는 0~100 상대 비율 기준으로 작성하세요.

## Optional Metadata Hints
- plan.layoutIntent와 section.sectionRole을 선택적으로 추가할 수 있습니다.
- 이 필드는 설명용 metadata이며, 기존 enum이나 구조를 바꾸면 안 됩니다.`;
