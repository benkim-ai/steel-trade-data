import os
import time
import requests
import logging
from dotenv import load_dotenv

# ===== CrewAI 1.14.2 호환 Import =====
from crewai import Agent, Task, Crew, Process, LLM
from crewai.tools import tool

# ===== LangChain Import =====
from langchain_community.tools import DuckDuckGoSearchRun

load_dotenv()
logging.basicConfig(level=logging.INFO)

# ===== LLM 설정 (CrewAI 1.14.2 호환 방식) =====
llm = LLM(
    model="openrouter/qwen/qwen-2.5-72b-instruct",
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
    temperature=0.35,
    max_tokens=3500
)

# ===== KIS OAuth2 자동 토큰 발급 =====
_kis_token_cache = {"token": None, "expires_at": 0}

def get_kis_access_token():
    now = time.time()
    if _kis_token_cache["token"] and now < _kis_token_cache["expires_at"]:
        return _kis_token_cache["token"]

    # 실전투자용 URL로 변경
    url = "https://openapi.koreainvestment.com:9443/oauth2/tokenP"
    res = requests.post(url, json={
        "grant_type": "client_credentials",
        "appkey": os.getenv("KIS_APP_KEY"),
        "appsecret": os.getenv("KIS_APP_SECRET")
    })
    data = res.json()

    if "access_token" not in data:
        raise RuntimeError(f"❌ KIS 토큰 발급 실패: {data}")

    # 들여쓰기 에러 수정 (공백 4칸)
    token = f"Bearer {data['access_token']}"
    _kis_token_cache["token"] = token
    _kis_token_cache["expires_at"] = now + 86400
    print("✅ KIS 액세스 토큰 자동 발급 완료")
    return token

# ===== 도구(Tools) 정의 =====
@tool("fetch_kis_portfolio")
def fetch_kis_portfolio() -> str:
    """KIS API로 계좌 요약 및 보유 종목 조회 (토큰 발급 통합)"""
    # 1. 토큰 발급 (KIS API 필수)
    token = get_kis_access_token()

    # 2. 계좌 조회 (실전투자용 URL 및 tr_id 변경)
    url = "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance"
    
    # 계좌번호 파싱 (하이픈 기준 분리)
    account_full = os.getenv("KIS_ACCOUNT", "")
    if "-" in account_full:
        cano, acnt_prdt_cd = account_full.split("-")
    else:
        cano = account_full[:8]
        acnt_prdt_cd = account_full[8:] if len(account_full) > 8 else "01"

    headers = {
        "authorization": token,
        "appkey": os.getenv("KIS_APP_KEY"),
        "appsecret": os.getenv("KIS_APP_SECRET"),
        "tr_id": "TTTC8434R" # 실전투자용 주식잔고조회 TR ID
    }
    params = {
        "CANO": cano,
        "ACNT_PRDT_CD": acnt_prdt_cd,
        "AFHR_FLPR_YN": "N", "UNPR_YN": "Y",
        "PRDT_TYPE_CD": "01", "ALPG_YN": "N",
        "CTX_AREA_FK100": "", "CTX_AREA_NK100": ""
    }
    res = requests.get(url, headers=headers, params=params)
    data = res.json()
    
    if res.status_code != 200:
        return f"⚠️ KIS API 오류: {data.get('msg1', '알 수 없음')}"
        
    holdings = data.get("output1", [])
    summary = data.get("output2", [{}])[0] if isinstance(data.get("output2"), list) else data.get("output2", {})
    
    out = f"총평가금액: {summary.get('tot_evlu_amt','0')}원\n"
    out += f"평가손익: {summary.get('scts_evlu_pfls_amt','0')}원\n"
    out += f"수익률: {summary.get('pfls_rt','0')}%\n"
    out += f"예수금: {summary.get('dnca_tot_amt','0')}원\n\n보유종목:\n"
    for h in holdings[:5]:
        out += f"- {h['prdt_name']}({h['pdno']}): {h['hldg_qty']}주 / 수익률 {h['evlu_pfls_rt']}% / 평가손익 {h['evlu_pfls_amt']}원\n"
    return out

@tool("search_stock_context")
def search_stock_context(query: str) -> str:
    """주식 종목에 대한 최신 뉴스 및 컨텍스트 검색"""
    search = DuckDuckGoSearchRun()
    try:
        result = search.run(query)
        return result
    except Exception as e:
        return f"검색 중 오류 발생: {str(e)}"

@tool("send_telegram")
def send_telegram(message: str) -> str:
    """텔레그램으로 메시지 발송"""
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    
    if not bot_token or not chat_id:
        return "텔레그램 봇 토큰 또는 챗 ID가 설정되지 않았습니다."
        
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown"
    }
    
    try:
        res = requests.post(url, json=payload)
        if res.status_code == 200:
            return "텔레그램 발송 성공"
        else:
            return f"텔레그램 발송 실패: {res.text}"
    except Exception as e:
        return f"텔레그램 발송 중 오류 발생: {str(e)}"

# ===== 에이전트 정의 (CrewAI 1.14.2 호환) =====
data_agent = Agent(
    role="KIS Portfolio Data Fetcher",
    goal="KIS API에서 계좌 요약과 보유 종목 정보를 정확히 추출",
    backstory="금융 데이터 수집 전문가로 정확성과 효율성을 최우선으로 하며, 실시간 시장 데이터 처리에 능숙합니다.",
    tools=[fetch_kis_portfolio],
    llm=llm
)

research_agent = Agent(
    role="Korean Market Research Analyst",
    goal="보유 종목별 최신 뉴스/시세 분석 및 모멘텀/리스크 도출",
    backstory="국내 증시 전문 애널리스트로 데이터 기반 인사이트와 명확한 모멘텀/리스크 분류에 강하며, 증권사 리포트를 매일 분석합니다.",
    tools=[search_stock_context],
    llm=llm
)

writer_agent = Agent(
    role="열혈 증권가 리포트 MC & AI 애널리스트",
    goal="정확한 금융 데이터를 바탕으로 노홍철+박준형 스타일의 과장되고 유쾌한 톤앤매너로 일일 투자 리포트 생성",
    backstory=\"\"\"당신은 증권가에서 전설적인 MC로 통하는 애널리스트입니다. 
데이터는 100% 정확하지만 전달 방식은 '형님!!!', '오우~!!!', '와우와우!!!', '헉!!!', '미쳤다!!!', 'So Sexy!!!', '나이스!!!', '붐!!!', '렛츠고!!!', '오 마이 갓!!!', 'Fantastic!!!', 'Bravo!!!' 같은 감탄사와 이모지를 적절히 섞어 에너지 넘치게 전달합니다. 
노홍철과 박준형을 섞은 듯한 재밌고 친근한 말투를 사용하며, 가끔 가벼운 욕설(예: 미친, 존나 등)을 섞어 써도 좋습니다.
형식(PART 1~2)은 절대 깨지 않으면서도, 읽는 사람이 웃고 흥분할 정도로 생동감 있게 작성합니다. 숫자/수익률/평가손익은 절대로 과장하지 않고 원본 데이터만 사용합니다.\"\"\",
    llm=llm
)

dispatcher_agent = Agent(
    role="Telegram Delivery Manager",
    goal="완성된 리포트를 텔레그램으로 정확히 발송 및 결과 확인",
    backstory="알림 자동화 전문가로 발송 성공/실패를 명확히 로깅하며, 사용자 경험을 최우선으로 생각합니다.",
    tools=[send_telegram],
    llm=llm
)

# ===== 태스크 정의 =====
task_data = Task(
    description="KIS API를 호출해 현재 계좌 요약과 보유 종목 목록을 정리하세요.",
    expected_output="계좌 요약 + 보유 종목 목록 (텍스트)",
    agent=data_agent
)

task_research = Task(
    description="각 보유 종목의 최신 뉴스/시세/증권사 의견을 조사하세요. 출력 형식: '종목명(코드): 뉴스요약 | 모멘텀 | 리스크'",
    expected_output="종목별 컨텍스트 요약",
    agent=research_agent
)

task_write = Task(
    description=\"\"\"
    아래 데이터를 바탕으로 정확히 아래 형식을 지키되, **요청된 톤앤매너**로 리포트를 작성하세요.

    📌 [톤앤매너 규칙 (절대 준수)]
    - 호칭: 무조건 '형님'으로 시작하고 유지
    - 감탄사: 오우~!!!, 와우와우!!!, 헉!!!, 미쳤다!!!, So Sexy!!!, Fantastic!!!, Bravo!!!, 나이스!!!, 붐!!!, 렛츠고!!!, 오 마이 갓!!! 등을 문장 중간과 끝에 연타로 배치
    - 이모지: 🚀💥💰📈🎯🔥💸 적절히 활용
    - 말투: 노홍철+박준형 스타일의 재밌고 과장된 말투 (가벼운 욕설 허용)
    - ⚠️ 중요: 숫자, 수익률, 평가손익은 100% 정확해야 함. 감탄사는 분위기 연출용일 뿐 데이터 조작 금지

    📌 [출력 형식 (절대 수정/생략 금지)]
    🚀 YOOO 형님!!! KIS 계좌 털어본 결과 리포트!!! 붐!!! 🚀
    (인트로: 계좌 전체 평가/수익률 언급 + 감탄사 2~3개)

    💰 [PART 1] 형님 계좌 현황 브리핑!!! (So Sexy!!!)
    📊 보유 종목 요약
    • 종목명 (코드): 보유주/수익률/평가손익

    🔍 [PART 2] 보유 종목별 딥 다이브 리포트!!!
    1️⃣ 종목명 (코드) - "한줄 캐치프레이즈!!!"
    • 오늘 상승/하락 이유: ...
    • 앞으로 주가 상승 모멘텀: ...
    • 앞으로 주가 하락 리스크: ...
    • 총평 (Sell/Buy): [HOLD/BUY/SELL] + 한줄 코멘트
    🔁 보유 종목 수만큼 반복

    ⚠️ 본 리포트는 AI가 생성한 정보 제공용이며, 투자 판단의 책임은 투자자 본인에게 있습니다.
    \"\"\",
    expected_output="형식이 100% 준수되고, 지정된 톤앤매너가 일관된 마크다운 리포트.",
    agent=writer_agent
)

task_send = Task(
    description="생성된 리포트를 텔레그램으로 발송하고 결과를 반환하세요.",
    expected_output="발송 성공 여부 메시지",
    agent=dispatcher_agent
)

# ===== Crew 실행 =====
crew = Crew(
    agents=[data_agent, research_agent, writer_agent, dispatcher_agent],
    tasks=[task_data, task_research, task_write, task_send],
    process=Process.sequential,
    verbose=True
)

if __name__ == "__main__":
    print("🚀 CrewAI 일일 리포트 파이프라인 실행 중...")
    result = crew.kickoff()
    print("\\n✅ 최종 결과:", result.raw)
