# KIS 일일 주식 리포트 (CrewAI 기반)

KIS(한국투자증권) API로 계좌 잔고를 조회하고, 네이버 뉴스 검색 API로 보유 종목 분석을 수행한 뒤, 텔레그램으로 일일 리포트를 발송하는 자동화 파이프라인입니다.

## 핵심 개선사항 (v2)

### 1. LLM 환각(Hallucination) 완전 차단

기존 코드의 가장 심각한 문제였던 LLM이 숫자를 지어내는 현상을 **근본적으로** 해결했습니다.

**해결 방법:**
- KIS API를 CrewAI 실행 **전에** 직접 호출하여 실제 데이터를 Python 변수로 확보
- 확보된 데이터를 `task_write`의 `description`에 **f-string으로 직접 주입**
- Task description에 "아래 숫자를 그대로 복사하세요. 절대 수정/반올림/변환하지 마세요" 강력 지시 포함
- `context=[task_research]` 파라미터로 이전 태스크 output을 명시적으로 전달

### 2. 전 종목 분석 보장

기존 코드에서 5개 종목 중 1개만 분석되던 문제를 해결했습니다.

**해결 방법:**
- 네이버 뉴스도 CrewAI 실행 **전에** 전 종목 일괄 수집 (`fetch_all_stock_news`)
- 수집된 뉴스 데이터를 `task_research`의 description에 직접 주입
- `task_research`에 "위 목록의 N개를 하나도 빠짐없이 모두 조사하세요. 하나라도 빠지면 실패" 명시
- `task_write`에도 "N개 종목 전부를 PART 2에 포함하세요. 하나라도 빠지면 실패" 명시

### 3. 아키텍처 개선

| 항목 | 기존 | 개선 |
|---|---|---|
| KIS 데이터 전달 | LLM 컨텍스트에 의존 | task description에 직접 주입 |
| 뉴스 수집 | research_agent가 임의 선택 | 전 종목 사전 수집 후 주입 |
| task 간 데이터 전달 | 미사용 | `context` 파라미터 명시 |
| async_execution | task_research에 True | 제거 (순서 보장) |
| LLM temperature | 0.35 | 0.3 (환각 감소) |

## 기술 스택

- **CrewAI**: 1.14.2
- **LLM**: `openrouter/qwen/qwen-2.5-72b-instruct` (OpenRouter)
- **KIS API**: 실전투자용 (`openapi.koreainvestment.com:9443`)
- **뉴스**: 네이버 검색 API (뉴스, 하루 25,000건 무료)
- **알림**: 텔레그램 Bot API

## 설치 및 실행

```bash
# 1. 의존성 설치
pip install -r requirements.txt

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일을 열어 각 API 키 입력

# 3. 실행
python main.py
```

## 환경 변수 (.env)

| 변수명 | 설명 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API 키 |
| `KIS_APP_KEY` | KIS 앱 키 |
| `KIS_APP_SECRET` | KIS 앱 시크릿 |
| `KIS_ACCOUNT` | 계좌번호 (예: `68222717-01`) |
| `NAVER_CLIENT_ID` | 네이버 검색 API Client ID |
| `NAVER_CLIENT_SECRET` | 네이버 검색 API Client Secret |
| `TELEGRAM_BOT_TOKEN` | 텔레그램 봇 토큰 |
| `TELEGRAM_CHAT_ID` | 텔레그램 채팅 ID |

## 리포트 형식

```
🚀 YOOO 형님!!! KIS 계좌 털어본 결과 리포트!!! 붐!!! 🚀

💰 [PART 1] 형님 계좌 현황 브리핑!!! (So Sexy!!!)
📊 보유 종목 요약
• 종목명 (코드): 보유주 / 수익률 / 평가손익

🔍 [PART 2] 보유 종목별 딥 다이브 리포트!!!
1️⃣ 종목명 (코드) - "한줄 캐치프레이즈!!!"
• 오늘 상승/하락 이유: ...
• 앞으로 주가 상승 모멘텀: ...
• 앞으로 주가 하락 리스크: ...
• 총평 (Sell/Buy): [HOLD/BUY/SELL] + 한줄 코멘트
```

## 자동 실행 (cron)

매일 오후 4시 30분 실행 예시:

```bash
30 16 * * 1-5 cd /path/to/project && python main.py >> /var/log/kis-report.log 2>&1
```
