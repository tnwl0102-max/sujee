# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

단일 HTML 파일로 동작하는 간단한 웹 프로젝트를 위한 보일러플레이트. 별도 빌드 도구, 서버, 패키지 매니저 없이 브라우저에서 바로 열 수 있는 결과물을 만든다.

## 절대 원칙 (예외 없음)

### 1. 단일 파일 출력
- 모든 결과물은 반드시 `index.html` 파일 하나로만 출력한다.
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
