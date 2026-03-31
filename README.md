# TABLE AI Studio

CSV/XLSX 표 데이터를 업로드하면 AI가 핵심 인사이트를 정리하고, 인포그래픽 시안 생성까지 이어주는 Next.js 기반 워크스페이스입니다.

이 저장소는 원래 PDF Q&A 챗봇 코드베이스에서 시작했습니다. 그래서 `pdf/` 폴더명, `pdfS3Key`, `pdfBase64` 같은 이름이 아직 남아 있지만, **현재 실제 메인 플로우는 표 데이터 분석 + 인포그래픽 생성**입니다.

## 현재 핵심 플로우

1. 사용자가 `csv` 또는 `xlsx` 파일을 업로드합니다.
2. 앱이 표를 정규화해서 세션으로 저장합니다.
3. Gemini가 표 데이터를 분석해 구조화된 `analysisData`를 생성합니다.
4. 왼쪽 패널에서 표 미리보기를 보여줍니다.
5. 오른쪽 패널에서
   - 분석 결과 기반 Q&A를 하거나
   - 인포그래픽 이미지를 생성/수정할 수 있습니다.
6. 세션은 IndexedDB에 저장되고, 공유 링크 플로우도 별도로 지원합니다.

---

## 기술 스택

- Next.js 16
- React 19
- TypeScript
- Zustand
- localforage (IndexedDB)
- Google Gemini (`@google/genai` + REST)
- Kysely + PostgreSQL
- AWS S3

---

## AI 모델

모델 정의 파일: `src/lib/ai-models.ts`

### 기본 텍스트/Q&A 모델
- `gemini-2.5-flash`

### 기본 이미지 생성 모델
- `gemini-2.5-flash-image`

### 선택 가능한 모델 목록
- Q&A: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview`
- Image: `gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`

선택된 모델은 Zustand 스토어(`src/lib/app-store.ts`)에 저장됩니다.

---

## 앱 구조

```text
src/
├─ app/
│  ├─ page.tsx
│  ├─ [id]/page.tsx
│  ├─ s/[publicId]/page.tsx
│  └─ api/share/*
├─ components/
│  ├─ MainApp.tsx
│  ├─ Sidebar.tsx
│  ├─ TableUploader.tsx
│  ├─ ApiKeyModal.tsx
│  └─ pdf/
│     ├─ left-panel/*
│     ├─ right-panel/*
│     └─ shared/*
└─ lib/
   ├─ app-store.ts
   ├─ store.ts
   ├─ session-types.ts
   ├─ analysis-schema.ts
   ├─ ai-models.ts
   ├─ table-utils.ts
   ├─ table-parser.ts
   ├─ s3.ts
   └─ db/*
```

---

## 주요 파일 설명

### 엔트리 / 라우팅

- `src/app/page.tsx`
  - 기본 홈 엔트리. `MainApp`을 렌더링합니다.

- `src/app/[id]/page.tsx`
  - 특정 세션 ID로 직접 진입하는 라우트입니다.

- `src/app/s/[publicId]/page.tsx`
  - 공유 세션 진입 라우트입니다.

- `src/app/s/[publicId]/ShareSessionClient.tsx`
  - 공유 세션용 클라이언트 로직입니다.
  - 비밀번호 입력 → `/api/share/open` 호출 → 좌/우 패널 구성까지 담당합니다.

### 메인 오케스트레이터

- `src/components/MainApp.tsx`
  - 현재 프로젝트의 중심 파일입니다.
  - 업로드, 세션 생성, 세션 복원, AI 분석 실행, 좌/우 패널 레이아웃 구성을 담당합니다.

- `src/components/Sidebar.tsx`
  - 세션 목록, 선택, 삭제, 새 세션 시작 UI입니다.

- `src/components/TableUploader.tsx`
  - CSV/XLSX 업로드 시작점입니다.

- `src/components/ApiKeyModal.tsx`
  - `localStorage`에 `gemini_api_key`가 없을 때 입력받는 모달입니다.

### 왼쪽 패널

- `src/components/pdf/left-panel/index.tsx`
  - 현재 활성 왼쪽 패널 진입점입니다.
  - 실제로는 `TablePreview`를 렌더링합니다.

- `src/components/pdf/left-panel/TablePreview.tsx`
  - 현재 메인 왼쪽 패널 UI입니다.
  - 표 헤더/행, 파일명, 상단 AI 요약을 보여줍니다.
  - 최대 40행까지 미리보기합니다.

- `src/components/pdf/left-panel/LegacyPdfViewer.tsx`
- `src/components/pdf/left-panel/LegacyAnnotationTooltip.tsx`
  - 예전 PDF 뷰어/캡처 챗봇 흐름의 레거시 파일입니다.

### 오른쪽 패널

- `src/components/pdf/right-panel/index.tsx`
  - 오른쪽 패널 진입점입니다.
  - 상황에 따라 `InfographicChatPanel` 또는 `InsightsPanel`을 렌더링합니다.

- `src/components/pdf/right-panel/RightPanelHeader.tsx`
  - 우측 패널 헤더 영역입니다.

- `src/components/pdf/right-panel/summary/InsightsPanel.tsx`
  - 분석 결과 표시 + Q&A 패널입니다.
  - 첫 질문에서는 분석 요약 + 실제 표 데이터 일부를 같이 모델에 전달합니다.
  - 공유 세션 모드에서는 `/api/share/chat`을 사용합니다.

- `src/components/pdf/right-panel/image-chat/InfographicChatPanel.tsx`
  - 현재 확장 기능의 핵심입니다.
  - 분석 결과를 기반으로 인포그래픽 브리프를 만들고, 이미지 생성 모델로 시안을 생성합니다.
  - 비율, 톤, 강조 방식 같은 컨트롤도 여기서 관리합니다.

- `src/components/pdf/right-panel/summary/*`
  - 키워드, 요약, 체크포인트, 추천 질문 등의 렌더링 컴포넌트입니다.

### 공통 렌더링

- `src/components/pdf/shared/MarkdownRenderer.tsx`
  - 마크다운 렌더링용 컴포넌트입니다.

- `src/components/pdf/shared/CitationBadge.tsx`
  - 과거 PDF 인용 UI의 흔적이 남아 있는 공통 배지 컴포넌트입니다.

---

## 데이터 흐름

### 1. 업로드와 세션 생성

업로드 로직 중심 파일: `src/components/MainApp.tsx`

업로드 시 앱은 다음 순서로 동작합니다.

1. `TableUploader`에서 파일을 선택합니다.
2. `MainApp.handleFileUpload()`가 실행됩니다.
3. `parseTableFile()`로 CSV/XLSX를 읽고 정규화합니다.
4. 원본 파일은 Base64로 읽습니다.
5. `TableSession`을 생성해서 IndexedDB에 저장합니다.
6. 세션 선택 후, 분석이 완료되지 않은 세션이면 AI 분석을 실행합니다.

### 2. 표 정규화

관련 파일:
- `src/lib/table-parser.ts`
- `src/lib/table-utils.ts`

현재 정규화 로직은 다음을 수행합니다.

- CSV/XLSX 파일 타입 판별
- 첫 번째 비어 있지 않은 행을 헤더로 사용
- 공백/빈 행 정리
- 열 수를 맞추기 위해 행 패딩
- 중복 헤더명 보정
- XLSX의 경우 첫 번째 시트를 기준으로 정규화

정규화된 데이터는 `tableData`와 `tableContext` 형태로 이후 AI 분석에 사용됩니다.

### 3. 초기 AI 분석

핵심 파일: `src/components/MainApp.tsx`

`runAnalysisForSession()`는 Gemini REST API를 호출해 다음 정보를 JSON으로 생성합니다.

- 제목
- 핵심 인사이트 요약
- 데이터 스토리 요약
- 키워드
- 바로 물어볼 수 있는 질문 3개
- 주의 포인트
- 인포그래픽 생성용 기본 브리프

이 결과는 `analysisData`로 정규화된 뒤 세션에 저장됩니다.

### 4. 왼쪽 패널 렌더링

관련 파일:
- `src/components/pdf/left-panel/index.tsx`
- `src/components/pdf/left-panel/TablePreview.tsx`

왼쪽 패널은 현재 PDF 뷰어가 아니라 **표 미리보기 패널**입니다.

표시 내용:
- AI 요약 카드
- 파일명 / 제목
- 컬럼 헤더
- 최대 40개 행 프리뷰

### 5. 오른쪽 패널 Q&A

관련 파일:
- `src/components/pdf/right-panel/summary/InsightsPanel.tsx`

Q&A 흐름은 다음과 같습니다.

1. 첫 질문 시 `analysisData` 기반 요약 컨텍스트를 만듭니다.
2. 세션에서 실제 테이블 데이터 일부(최대 120행)를 읽습니다.
3. 선택된 Q&A 모델로 스트리밍 응답을 생성합니다.
4. 후속 질문부터는 대화 기록 중심으로 이어갑니다.

시스템 지시는 현재 **테이블 분석 AI 어시스턴트** 역할에 맞춰 한국어/실무형 응답을 요구합니다.

### 6. 인포그래픽 생성

관련 파일:
- `src/components/pdf/right-panel/image-chat/InfographicChatPanel.tsx`

이미지 생성 흐름은 다음과 같습니다.

1. 분석 결과가 준비되면 기본 인포그래픽 프롬프트를 사용합니다.
2. 제목, 키워드, 인사이트, 이슈, 테이블 컨텍스트를 조합해 이미지 프롬프트를 만듭니다.
3. 사용자가 비율/톤/강조 옵션을 조정할 수 있습니다.
4. 선택된 이미지 모델로 인포그래픽 시안을 생성합니다.
5. 생성된 이미지와 텍스트 메모를 세션 기록에 저장합니다.

---

## 상태 관리와 저장

### Zustand UI 상태

파일: `src/lib/app-store.ts`

주요 상태:
- 현재 세션 ID
- 현재 파일명
- 분석 상태
- 선택된 Q&A / 이미지 모델
- 세션별 채팅 캐시
- 세션별 주석 캐시
- 사이드바 / API 키 모달 상태

대용량 세션 본문은 localStorage가 아니라 IndexedDB에 둡니다.

### IndexedDB 세션 저장

파일: `src/lib/store.ts`

세션은 `localforage`를 통해 IndexedDB에 저장됩니다.

저장 내용:
- 파일 메타데이터
- 정규화된 표 데이터
- 분석 결과
- Q&A 메시지
- 인포그래픽 메시지
- 인포그래픽 컨트롤

### 스키마 검증

파일: `src/lib/analysis-schema.ts`

`TableSession`, `AnalysisData`, 메시지 구조를 Zod로 검증하고 정규화합니다.

---

## 공유 기능

공유 관련 API는 `src/app/api/share/*`에 있습니다.

### `POST /api/share/upload-url`
- 파일: `src/app/api/share/upload-url/route.ts`
- S3 업로드용 presigned URL을 발급합니다.
- 내부 이름은 아직 `createPdfUploadPresignedUrl`을 사용합니다.

### `POST /api/share/create`
- 파일: `src/app/api/share/create/route.ts`
- 공유 세션을 생성합니다.
- 응답으로 `publicId`, `shareUrl`을 반환합니다.

### `POST /api/share/open`
- 파일: `src/app/api/share/open/route.ts`
- 공유 링크 + 비밀번호로 세션을 엽니다.
- payload와 함께 `pdfBase64`도 반환하는데, 이것 역시 PDF 시절 명칭이 남은 것입니다.

### `POST /api/share/chat`
- 파일: `src/app/api/share/chat/route.ts`
- 공유 세션 Q&A를 서버에서 처리합니다.
- 채팅 횟수 제한을 차감하고, `gemini-2.5-flash`로 답변을 생성합니다.

---

## 핵심 타입

파일: `src/lib/session-types.ts`

### `AnalysisData`
- 제목
- 요약들
- 키워드
- 질문 후보(`insights`)
- 이슈 / 체크포인트
- 생성된 인포그래픽 프롬프트
- 활성 인포그래픽 프롬프트
- 테이블 컨텍스트
- 정규화된 테이블 데이터
- 분석 상태

### `TableSession`
- 세션 ID
- 파일명 / 파일 타입
- 원본 파일 base64
- `tableData`
- `analysisData`
- 일반 채팅 메시지
- 인포그래픽 메시지
- 인포그래픽 컨트롤
- 생성 시각

---

## 레거시 PDF 흔적

이 저장소는 PDF Q&A 앱에서 출발했기 때문에 아래 흔적이 남아 있습니다.

- `src/components/pdf/` 경로명
- `LegacyPdfViewer.tsx`, `LegacyAnnotationTooltip.tsx`
- `pdfS3Key`, `pdfBase64` 같은 API 필드명
- `PdfSession` alias
- `src/app/layout.tsx`의 오래된 description (`Analyze and chat with your PDF documents`)

이 이름들은 탐색할 때는 중요하지만, **현재 실제 사용자 플로우를 설명하지는 않습니다.**

---

## 지금 수정하려면 어디부터 보면 좋은가

### 업로드/분석 플로우를 바꾸려면
- `src/components/MainApp.tsx`
- `src/lib/table-utils.ts`
- `src/lib/table-parser.ts`
- `src/lib/session-types.ts`

### Q&A를 바꾸려면
- `src/components/pdf/right-panel/summary/InsightsPanel.tsx`
- `src/lib/app-store.ts`
- `src/lib/ai-models.ts`

### 인포그래픽 생성을 바꾸려면
- `src/components/pdf/right-panel/image-chat/InfographicChatPanel.tsx`
- `src/lib/ai-models.ts`
- `src/lib/session-types.ts`

### 저장 구조를 바꾸려면
- `src/lib/store.ts`
- `src/lib/analysis-schema.ts`
- `src/lib/session-types.ts`

### 공유 기능을 바꾸려면
- `src/app/api/share/create/route.ts`
- `src/app/api/share/open/route.ts`
- `src/app/api/share/chat/route.ts`
- `src/app/s/[publicId]/ShareSessionClient.tsx`
