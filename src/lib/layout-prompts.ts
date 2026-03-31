export const DEFAULT_LAYOUT_SYSTEM_PROMPT = `레이아웃 생성 규칙:
1. layoutPlans는 서로 다른 레이아웃 전략을 가진 시안 3개를 반드시 작성하세요.
2. 각 layoutPlan.layoutType은 항상 "dashboard"로 작성하세요.
3. 3개 시안의 차이는 aspectRatio 차이보다 차트 종류, 정보 배치, KPI 사용 여부, 섹션 반복 방식 같은 레이아웃 구성 차이에서 나와야 합니다.
4. 특별한 이유가 없다면 3개 시안 모두 동일한 aspectRatio를 유지하세요. 기본은 "portrait"를 우선합니다.
5. 각 layoutPlan.sections는 실제 배치 순서대로 작성하고, section type은 "header", "chart-group", "kpi-group", "takeaway", "note" 중에서만 선택하세요.
6. chart-group 안의 charts는 "bar", "line", "donut", "pie", "stacked-bar", "map" 중에서만 선택하세요.
7. 세 시안은 각각 예를 들어 (a) 메인 비교 차트 중심형, (b) KPI+차트 혼합형, (c) 반복 섹션 리포트형처럼 구조적으로 다른 안이어야 합니다.
8. 각 시안의 description은 차트 배치 전략과 읽는 구조 차이가 드러나게 작성하세요.`;
