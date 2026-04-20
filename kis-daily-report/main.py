"""
KIS 일일 주식 리포트 - CrewAI 1.14.2
=====================================
핵심 개선사항:
1. LLM 환각 방지: KIS API 데이터를 task description에 직접 주입
2. 전 종목 분석 보장: 보유 종목 목록을 명시적으로 task에 전달
3. 네이버 검색 API: 종목별 최신 뉴스 + 증권사 분석
4. context 파라미터로 task 간 데이터 명시적 전달
"""

import os
import re
import time
import requests
import logging
from dotenv import load_dotenv

# ===== CrewAI 1.14.2 호환 Import =====
from crewai import Agent, Task, Crew, Process, LLM
from crewai.tools import tool

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ===== LLM 설정 =====
llm = LLM(
    model="openrouter/qwen/qwen-2.5-72b-instruct",
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
    temperature=0.3,   # 낮을수록 환각 감소
    max_tokens=4000
)

# =========================================================
# STEP 1: KIS API - CrewAI 외부에서 직접 호출하여 실제 데이터 확보
#         (환각 방지의 핵심: LLM에게 데이터를 "기억"시키지 않고
#          task description에 직접 박아 넣음)
# =========================================================

_kis_token_cache = {"token": None, "expires_at": 0}


def get_kis_access_token() -> str:
    """KIS OAuth2 토큰 발급 (캐시 포함)"""
    now = time.time()
    if _kis_token_cache["token"] and now < _kis_token_cache["expires_at"]:
        return _kis_token_cache["token"]

    url = "https://openapi.koreainvestment.com:9443/oauth2/tokenP"
    res = requests.post(url, json={
        "grant_type": "client_credentials",
        "appkey": os.getenv("KIS_APP_KEY"),
        "appsecret": os.getenv("KIS_APP_SECRET")
    }, timeout=15)
    data = res.json()

    if "access_token" not in data:
        raise RuntimeError(f"KIS 토큰 발급 실패: {data}")

    token = f"Bearer {data['access_token']}"
    _kis_token_cache["token"] = token
    _kis_token_cache["expires_at"] = now + 86400
    logger.info("KIS 액세스 토큰 발급 완료")
    return token


def fetch_portfolio_raw() -> dict:
    """
    KIS API에서 계좌 잔고를 직접 조회하여 raw dict 반환.
    CrewAI 외부에서 호출하여 실제 숫자를 확보한다.
    """
    token = get_kis_access_token()

    account_full = os.getenv("KIS_ACCOUNT", "")
    if "-" in account_full:
        cano, acnt_prdt_cd = account_full.split("-", 1)
    else:
        cano = account_full[:8]
        acnt_prdt_cd = account_full[8:] if len(account_full) > 8 else "01"

    url = "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance"
    headers = {
        "authorization": token,
        "appkey": os.getenv("KIS_APP_KEY"),
        "appsecret": os.getenv("KIS_APP_SECRET"),
        "tr_id": "TTTC8434R"
    }
    params = {
        "CANO": cano,
        "ACNT_PRDT_CD": acnt_prdt_cd,
        "AFHR_FLPR_YN": "N",
        "UNPR_YN": "Y",
        "PRDT_TYPE_CD": "01",
        "ALPG_YN": "N",
        "CTX_AREA_FK100": "",
        "CTX_AREA_NK100": ""
    }

    res = requests.get(url, headers=headers, params=params, timeout=15)
    if res.status_code != 200:
        raise RuntimeError(f"KIS API HTTP {res.status_code}: {res.text}")

    data = res.json()
    if data.get("rt_cd") != "0":
        raise RuntimeError(f"KIS API 오류: {data.get('msg1', '알 수 없음')}")

    return data


def build_portfolio_text(data: dict) -> tuple[str, list[str]]:
    """
    KIS API raw 응답에서 계좌 현황 텍스트와 종목 이름 목록을 생성.
    반환: (portfolio_text, stock_name_list)
    """
    holdings = data.get("output1", [])
    summary_list = data.get("output2", [])
    summary = summary_list[0] if isinstance(summary_list, list) and summary_list else {}

    # 숫자 포맷 헬퍼
    def fmt(val: str, suffix: str = "원") -> str:
        try:
            n = int(val.replace(",", "").replace(" ", ""))
            return f"{n:,}{suffix}"
        except Exception:
            return f"{val}{suffix}"

    def fmt_pct(val: str) -> str:
        try:
            return f"{float(val):.2f}%"
        except Exception:
            return f"{val}%"

    lines = [
        "=== [계좌 요약] ===",
        f"총평가금액    : {fmt(summary.get('tot_evlu_amt', '0'))}",
        f"총매입금액    : {fmt(summary.get('pchs_amt_smtl_amt', '0'))}",
        f"평가손익합계  : {fmt(summary.get('scts_evlu_pfls_amt', '0'))}",
        f"수익률        : {fmt_pct(summary.get('evlu_pfls_smtl_rt', summary.get('pfls_rt', '0')))}",
        f"예수금        : {fmt(summary.get('dnca_tot_amt', '0'))}",
        "",
        f"=== [보유 종목 목록] (총 {len(holdings)}개) ===",
    ]

    stock_names = []
    for h in holdings:
        name = h.get("prdt_name", "")
        code = h.get("pdno", "")
        qty = h.get("hldg_qty", "0")
        avg_price = h.get("pchs_avg_pric", "0")
        cur_price = h.get("prpr", "0")
        pfls_rt = h.get("evlu_pfls_rt", "0")
        pfls_amt = h.get("evlu_pfls_amt", "0")
        evlu_amt = h.get("evlu_amt", "0")

        lines.append(
            f"  - {name}({code}): "
            f"보유 {qty}주 | 평균단가 {fmt(avg_price)} | 현재가 {fmt(cur_price)} | "
            f"평가금액 {fmt(evlu_amt)} | 수익률 {fmt_pct(pfls_rt)} | 평가손익 {fmt(pfls_amt)}"
        )
        if name:
            stock_names.append(f"{name}({code})")

    return "\n".join(lines), stock_names


# =========================================================
# STEP 2: 네이버 검색 API 헬퍼
# =========================================================

def naver_search(query: str, display: int = 5, sort: str = "date") -> str:
    """네이버 뉴스 검색 API 호출"""
    client_id = os.getenv("NAVER_CLIENT_ID")
    client_secret = os.getenv("NAVER_CLIENT_SECRET")

    if not client_id or not client_secret:
        return "네이버 API 키 미설정 (.env에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 추가 필요)"

    url = "https://openapi.naver.com/v1/search/news.json"
    headers = {
        "X-Naver-Client-Id": client_id,
        "X-Naver-Client-Secret": client_secret
    }
    params = {"query": query, "display": display, "sort": sort}

    try:
        res = requests.get(url, headers=headers, params=params, timeout=10)
        if res.status_code != 200:
            return f"네이버 API 오류 (HTTP {res.status_code})"

        items = res.json().get("items", [])
        if not items:
            return f"'{query}' 검색 결과 없음"

        def strip_tags(text: str) -> str:
            return re.sub(r"<[^>]+>", "", text)

        results = []
        for i, item in enumerate(items, 1):
            title = strip_tags(item.get("title", ""))
            desc = strip_tags(item.get("description", ""))
            pub = item.get("pubDate", "")
            results.append(f"{i}. [{title}] {desc} ({pub})")

        return "\n".join(results)

    except requests.exceptions.Timeout:
        return f"네이버 검색 타임아웃: '{query}'"
    except Exception as e:
        return f"네이버 검색 오류: {e}"


def fetch_all_stock_news(stock_names: list[str]) -> str:
    """
    모든 보유 종목의 뉴스를 CrewAI 외부에서 직접 수집.
    research_agent의 누락 방지를 위해 사전 수집 후 task에 주입.
    """
    all_news = []
    for stock in stock_names:
        logger.info(f"뉴스 수집 중: {stock}")
        news = naver_search(f"{stock} 주가", display=5, sort="date")
        analysis = naver_search(f"{stock} 증권사 목표가 전망", display=3, sort="sim")
        all_news.append(
            f"\n{'='*50}\n"
            f"[{stock}] 최신 뉴스\n{news}\n\n"
            f"[{stock}] 증권사 분석\n{analysis}"
        )
        time.sleep(0.2)  # Rate limit 여유

    return "\n".join(all_news)


# =========================================================
# STEP 3: CrewAI Tools (agent가 추가 검색이 필요할 때만 사용)
# =========================================================

@tool("search_stock_context")
def search_stock_context(query: str) -> str:
    """네이버 뉴스 검색 API로 주식 종목의 최신 뉴스 및 증권사 분석 검색.
    종목명 또는 종목코드를 포함한 검색어를 입력하면 최신 뉴스 5건과 증권사 분석 3건을 반환합니다.
    예: 'SK하이닉스 주가 전망', '삼성전자 실적 분석'"""
    news = naver_search(query + " 주가", display=5, sort="date")
    analysis = naver_search(query + " 증권사 목표가 분석", display=3, sort="sim")
    return (
        f"=== [{query}] 최신 뉴스 ===\n{news}\n\n"
        f"=== [{query}] 증권사 분석 ===\n{analysis}"
    )


@tool("send_telegram")
def send_telegram(message: str) -> str:
    """텔레그램으로 메시지 발송 (4096자 초과 시 자동 분할)"""
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")

    if not bot_token or not chat_id:
        return "텔레그램 봇 토큰 또는 챗 ID 미설정"

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    max_len = 4000  # 마크다운 파싱 여유분 포함
    chunks = [message[i:i + max_len] for i in range(0, len(message), max_len)]

    try:
        for i, chunk in enumerate(chunks):
            payload = {"chat_id": chat_id, "text": chunk, "parse_mode": "Markdown"}
            res = requests.post(url, json=payload, timeout=10)
            if res.status_code != 200:
                # Markdown 실패 시 plain text 재시도
                payload.pop("parse_mode")
                res = requests.post(url, json=payload, timeout=10)
                if res.status_code != 200:
                    return f"텔레그램 발송 실패 (파트 {i+1}/{len(chunks)}): {res.text}"
            if len(chunks) > 1:
                time.sleep(0.5)

        return f"텔레그램 발송 성공 ({len(chunks)}개 메시지)"
    except Exception as e:
        return f"텔레그램 발송 오류: {e}"


# =========================================================
# STEP 4: CrewAI 에이전트 정의
# =========================================================

research_agent = Agent(
    role="Korean Market Research Analyst",
    goal="보유 종목별 최신 뉴스/시세 분석 및 모멘텀/리스크 도출. 지정된 모든 종목을 빠짐없이 분석.",
    backstory=(
        "국내 증시 전문 애널리스트로 데이터 기반 인사이트와 명확한 모멘텀/리스크 분류에 강하며, "
        "증권사 리포트를 매일 분석합니다. 네이버 검색 API는 Rate Limit이 넉넉하므로 "
        "모든 종목을 순서대로 빠짐없이 검색합니다."
    ),
    tools=[search_stock_context],
    llm=llm,
    verbose=True
)

writer_agent = Agent(
    role="열혈 증권가 리포트 MC & AI 애널리스트",
    goal=(
        "제공된 계좌 데이터와 리서치 결과를 바탕으로 노홍철+박준형 스타일의 "
        "과장되고 유쾌한 톤앤매너로 일일 투자 리포트 생성. "
        "숫자는 절대 변경하지 않고 원본 그대로 사용."
    ),
    backstory=(
        "당신은 증권가에서 전설적인 MC로 통하는 애널리스트입니다. "
        "데이터는 100% 정확하지만 전달 방식은 '형님!!!', '오우~!!!', '와우와우!!!', "
        "'헉!!!', '미쳤다!!!', 'So Sexy!!!', '나이스!!!', '붐!!!', '렛츠고!!!', "
        "'오 마이 갓!!!', 'Fantastic!!!', 'Bravo!!!' 같은 감탄사와 이모지를 적절히 섞어 "
        "에너지 넘치게 전달합니다. 노홍철과 박준형을 섞은 듯한 재밌고 친근한 말투를 사용하며, "
        "가끔 가벼운 욕설(예: 미친, 존나 등)을 섞어 써도 좋습니다. "
        "형식(PART 1~2)은 절대 깨지 않으면서도, 읽는 사람이 웃고 흥분할 정도로 생동감 있게 작성합니다. "
        "숫자/수익률/평가손익은 절대로 과장하지 않고 원본 데이터만 사용합니다."
    ),
    llm=llm,
    verbose=True
)

dispatcher_agent = Agent(
    role="Telegram Delivery Manager",
    goal="완성된 리포트를 텔레그램으로 정확히 발송 및 결과 확인",
    backstory="알림 자동화 전문가로 발송 성공/실패를 명확히 로깅하며, 사용자 경험을 최우선으로 생각합니다.",
    tools=[send_telegram],
    llm=llm,
    verbose=True
)


# =========================================================
# STEP 5: 메인 실행 함수 - 데이터 사전 수집 후 task에 주입
# =========================================================

def build_and_run_crew():
    """
    핵심 전략:
    1. CrewAI 실행 전에 KIS API와 네이버 API를 직접 호출하여 실제 데이터 확보
    2. 확보된 데이터를 task description에 f-string으로 직접 주입
    3. LLM이 숫자를 "상상"할 여지를 원천 차단
    """

    # ── 1. KIS 포트폴리오 데이터 직접 수집 ──────────────────────
    logger.info("KIS API 포트폴리오 조회 중...")
    try:
        raw_data = fetch_portfolio_raw()
        portfolio_text, stock_names = build_portfolio_text(raw_data)
        logger.info(f"포트폴리오 조회 완료: {len(stock_names)}개 종목")
    except Exception as e:
        logger.error(f"KIS API 오류: {e}")
        portfolio_text = f"KIS API 조회 실패: {e}"
        stock_names = []

    # ── 2. 네이버 뉴스 전 종목 사전 수집 ────────────────────────
    logger.info("네이버 뉴스 전 종목 수집 중...")
    if stock_names:
        news_text = fetch_all_stock_news(stock_names)
    else:
        news_text = "보유 종목 없음 또는 KIS API 오류로 뉴스 수집 불가"

    stock_list_str = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(stock_names))

    # ── 3. Task 정의 (실제 데이터 직접 주입) ────────────────────

    task_research = Task(
        description=f"""
아래에 나열된 보유 종목 전체에 대해 최신 뉴스와 증권사 분석을 조사하세요.

[필수 조사 종목 목록 - 아래 {len(stock_names)}개를 하나도 빠짐없이 모두 조사하세요]
{stock_list_str}

⚠️ 경고: 위 목록에서 단 하나라도 빠지면 이 태스크는 실패입니다.
⚠️ 경고: search_stock_context 도구를 각 종목마다 반드시 호출하세요.

[사전 수집된 뉴스 데이터 (참고용 - 추가 검색도 가능)]
{news_text}

[출력 형식]
각 종목별로 아래 형식으로 정리하세요:
종목명(코드):
  - 오늘 주요 뉴스 요약: ...
  - 상승 모멘텀: ...
  - 하락 리스크: ...
""",
        expected_output=(
            f"보유 {len(stock_names)}개 종목 전체의 뉴스 요약, 모멘텀, 리스크가 "
            "빠짐없이 포함된 분석 텍스트"
        ),
        agent=research_agent
    )

    task_write = Task(
        description=f"""
아래에 제공된 [계좌 현황 데이터]와 [종목 분석 결과]를 바탕으로 일일 투자 리포트를 작성하세요.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨🚨🚨 [데이터 사용 규칙 - 절대 준수] 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 아래 [계좌 현황 데이터]의 모든 숫자를 그대로 복사하세요.
2. 절대로 숫자를 수정/반올림/변환/추측하지 마세요.
3. 데이터에 없는 숫자를 만들어내는 것은 엄격히 금지됩니다.
4. 수익률, 평가손익, 총평가금액 등 모든 수치는 아래 데이터에서만 가져오세요.
5. 보유 종목은 아래 목록의 {len(stock_names)}개 전부를 PART 2에 포함하세요.
   하나라도 빠지면 이 태스크는 실패입니다.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[계좌 현황 데이터 - 이 숫자들을 그대로 복사하세요]
{portfolio_text}

[보유 종목 목록 - PART 2에 전부 포함하세요]
{stock_list_str}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 [톤앤매너 규칙 - 절대 준수]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 호칭: 무조건 '형님'으로 시작하고 유지
- 감탄사: 오우~!!!, 와우와우!!!, 헉!!!, 미쳤다!!!, So Sexy!!!, Fantastic!!!, Bravo!!!, 나이스!!!, 붐!!!, 렛츠고!!!, 오 마이 갓!!! 등을 문장 중간과 끝에 연타로 배치
- 이모지: 🚀💥💰📈🎯🔥💸 적절히 활용
- 말투: 노홍철+박준형 스타일의 재밌고 과장된 말투 (가벼운 욕설 허용)
- ⚠️ 중요: 숫자, 수익률, 평가손익은 100% 정확해야 함. 감탄사는 분위기 연출용일 뿐 데이터 조작 절대 금지

📌 [출력 형식 - 절대 수정/생략 금지]

🚀 YOOO 형님!!! KIS 계좌 털어본 결과 리포트!!! 붐!!! 🚀
(인트로: 계좌 전체 평가/수익률 언급 + 감탄사 2~3개)

💰 [PART 1] 형님 계좌 현황 브리핑!!! (So Sexy!!!)
📊 보유 종목 요약
• 종목명 (코드): 보유주 / 수익률 / 평가손익
(위 계좌 현황 데이터의 숫자를 그대로 복사하여 모든 종목 나열)

🔍 [PART 2] 보유 종목별 딥 다이브 리포트!!!
(아래 형식으로 {len(stock_names)}개 종목 전부 작성 - 하나도 빠지면 안 됨)
1️⃣ 종목명 (코드) - "한줄 캐치프레이즈!!!"
• 오늘 상승/하락 이유: ...
• 앞으로 주가 상승 모멘텀: ...
• 앞으로 주가 하락 리스크: ...
• 총평 (Sell/Buy): [HOLD/BUY/SELL] + 한줄 코멘트
(2️⃣, 3️⃣, ... {len(stock_names)}️⃣까지 동일 형식 반복)

⚠️ 본 리포트는 AI가 생성한 정보 제공용이며, 투자 판단의 책임은 투자자 본인에게 있습니다.
""",
        expected_output=(
            "형식이 100% 준수되고, 지정된 톤앤매너가 일관되며, "
            f"계좌 데이터 숫자가 정확하고, {len(stock_names)}개 종목이 "
            "전부 포함된 마크다운 리포트"
        ),
        agent=writer_agent,
        context=[task_research]   # research 결과를 명시적으로 전달
    )

    task_send = Task(
        description="생성된 리포트를 텔레그램으로 발송하고 결과를 반환하세요.",
        expected_output="발송 성공 여부 메시지",
        agent=dispatcher_agent,
        context=[task_write]      # write 결과를 명시적으로 전달
    )

    # ── 4. Crew 실행 ─────────────────────────────────────────
    crew = Crew(
        agents=[research_agent, writer_agent, dispatcher_agent],
        tasks=[task_research, task_write, task_send],
        process=Process.sequential,
        verbose=True
    )

    logger.info("CrewAI 파이프라인 실행 시작...")
    result = crew.kickoff()
    logger.info("CrewAI 파이프라인 완료")
    return result


# =========================================================
# STEP 6: 엔트리포인트
# =========================================================

if __name__ == "__main__":
    print("🚀 KIS 일일 리포트 파이프라인 시작!!!")
    result = build_and_run_crew()
    print("\n✅ 최종 결과:\n", result.raw if hasattr(result, "raw") else result)
