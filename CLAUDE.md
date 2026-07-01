# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

세 가지 기능을 포함한 프로젝트:
1. **단일 HTML 웹앱** (`index.html`) — 브라우저에서 바로 열 수 있는 보일러플레이트
2. **충청본부 근무일정 Slack 자동 보고** (`automation/daily-report.js`) — GitHub Actions로 매일 아침 실행
3. **평가 대비 진행현황 Slack 보고** (`automation/eval-tracker.js`) — 구글시트 데이터를 읽어 마감 리마인더/주간 요약 전송

## 절대 원칙 (예외 없음)

### 1. 단일 파일 출력 (index.html)
- 웹앱 결과물은 반드시 `index.html` 파일 하나로만 출력한다.
- CSS는 `<style>` 태그 안에, JavaScript는 `<script>` 태그 안에 작성한다.
- `.css`, `.js` 등 별도 파일을 생성하거나 외부 파일을 `<link>` / `<src>`로 참조하지 않는다.
- 외부 CDN 라이브러리(`<script src="https://...">`)는 허용된다.

### 2. API 키 및 민감 정보는 반드시 사용자 입력으로 처리
- API 키, 토큰, 비밀번호 등 민감한 값을 코드 내 변수나 상수로 하드코딩하지 않는다.
- 반드시 `<input type="password">` 또는 `<input type="text">` 요소를 만들어 사용자가 직접 입력하도록 구성한다.
- 입력값은 사용 시점에 DOM에서 읽어오며, 전역 변수에 저장하지 않는다.

```html
<!-- 올바른 예시 -->
<input type="password" id="apiKey" placeholder="API Key를 입력하세요">
<script>
  function callApi() {
    const apiKey = document.getElementById('apiKey').value;
    // apiKey 사용
  }
</script>

<!-- 금지된 예시 -->
<script>
  const API_KEY = 'sk-xxxx'; // 절대 금지
</script>
```

## 자동화 시스템 (automation/)

### 아키텍처
`automation/daily-report.js` — Node.js + Playwright 스크립트가 GitHub Actions로 실행됨.

**데이터 소스 2가지:**
- **케어포 (4개 센터)**: Playwright로 eform.caring.co.kr 로그인 → carefor 근무일정표 스크래핑
  - 대전 둔산점 `23017000602`, 대전 서구점 `23017000617`, 천안 서북구점 `24413000644`, 청주점 `24311001003`
- **구글시트 (1개 센터)**: 방문요양대전점 — CSV export URL로 데이터 fetch

**출력:** Slack 채널 `C087JL55TA6`에 메인 메시지 + 센터별 스레드 답글

### 실행
```bash
cd automation && npm install && node daily-report.js
```
필수 환경변수: `SLACK_BOT_TOKEN`, `CAREFOR_BASIC_USER`, `CAREFOR_BASIC_PASS`, `CAREFOR_LOGIN_ID`, `CAREFOR_LOGIN_PASS`

### GitHub Actions
- `.github/workflows/daily-report.yml` — 월~토 09:00 KST 자동 실행
- Secrets는 GitHub repo Settings > Secrets에 저장
- 수동 실행: Actions 탭 > "Run workflow" (재실행 아님 — 재실행은 이전 커밋 코드를 사용)

### 케어포 로그인 플로우
1. HTTP Basic Auth → `eform.caring.co.kr/carefor` 접속
2. form POST → `www.carefor.co.kr/exe/login_proc.php`
3. `layerModal` display:none 처리 (알림 모달 제거)
4. 8.직원관리 > 8-2.근무일정표 메뉴 클릭
5. `staff_list_table`에서 월간 데이터, `staffWorkPlanCalendarTbl`에서 당일 모달 데이터 추출

### 구글시트 형식
- 열: 직원명, 담당직종, 기준근무(h), 추가근무(h), 1일~31일
- 날짜 셀: `08:30~17:30` (근무), `연차`/`반차`/`대체휴무` (휴가), 빈칸 (휴무)
- 시트 ID: `1Ns2HzBXbK2nCQuPhpO49KSr7Oyo5f5OgGLz4hvnueP8` (gid: `1190101526`)
- "링크가 있는 모든 사용자 보기 가능"으로 공유 필수

### Slack 봇
- 앱: 직원근태봇(뚜) — api.slack.com/apps `A0BBZEU10DR`
- 봇 토큰: `xoxb-...` (GitHub Secrets `SLACK_BOT_TOKEN`)
- 봇이 채널에 `/invite`되어 있어야 메시지 전송 가능

### 평가 대비 진행현황 자동화 (eval-tracker)

**아키텍처**: 구글시트 Apps Script 웹앱 → GitHub Actions → Slack 전송

**구글시트**: `충청본부 평가 대비 업무 관리` (ID: `18fAjz171Zr49ToOEZjW1dyOgylq599E8HKDcsBQG-PI`)
- 탭 구조: 대시보드 / 대전둔산점 / 대전서구점 / 천안서북구점 / 청주점 / 지표목록
- 36개 평가지표별 세부항목, 담당자, 마감일, 상태를 추적
- Apps Script(`apps-script-setup.js`)로 구조 세팅 및 웹앱 API 제공

**파일**:
- `automation/eval-tracker.js` — 시트 웹앱 API에서 JSON fetch → Slack 메시지 전송
- `automation/apps-script-setup.js` — 시트에 붙여넣을 Apps Script 코드 (참조용)
- `.github/workflows/eval-tracker.yml` — 월~금 09:00 일일 리마인더 + 금 17:00 주간 요약

**실행**:
```bash
cd automation && REPORT_MODE=daily node eval-tracker.js
```
필수 환경변수: `SLACK_BOT_TOKEN`, `EVAL_SHEET_WEBAPP_URL`, `EVAL_SLACK_CHANNEL`(선택)

## Skill routing

이 프로젝트에는 웹앱 제작을 위한 스킬이 `.claude/skills/`에 내장되어 있다.
gstack 없이도 Claude Code를 열면 자동으로 사용 가능하다.

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- 아이디어/기획 논의 → invoke /office-hours
- 디자인 방향 결정 → invoke /design-consultation
- HTML/CSS 디자인 완성 → invoke /design-html
- 시각적 완성도 점검 → invoke /design-review
- 버그/오류 → invoke /investigate
- 동작 테스트/QA → invoke /qa-only
- 코드 리뷰 → invoke /review

## 내장 스킬 목록

| 스킬 | 용도 |
|------|------|
| /office-hours | 아이디어 구체화, 기능 범위 논의 |
| /design-consultation | 디자인 시스템, 색상, 레이아웃 방향 결정 |
| /design-html | HTML/CSS 디자인 최종 완성 |
| /design-review | 완성된 화면의 시각적 품질 점검 |
| /investigate | 버그 원인 추적 및 수정 |
| /qa-only | 주요 기능 동작 테스트 보고서 |
| /review | 코드 품질 리뷰 |
