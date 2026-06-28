const https = require('https');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = process.env.CHECKLIST_SLACK_CHANNEL;

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function fetchTasks() {
  const result = await httpsRequest({
    hostname: 'api.notion.com',
    path: `/v1/databases/${NOTION_DB_ID}/query`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
  }, {
    sorts: [{ property: '마감일', direction: 'ascending' }],
  });

  if (!result.results) {
    console.error('Notion API 응답 오류:', JSON.stringify(result));
    throw new Error(result.message || 'Notion API 오류');
  }

  return result.results.map(page => {
    const props = page.properties;
    const title = props['업무명']?.title?.[0]?.plain_text || '(제목 없음)';
    const status = props['상태']?.select?.name || props['상태']?.rich_text?.[0]?.plain_text || '미시작';
    const dueDate = props['마감일']?.date?.start || null;
    const priority = props['우선순위']?.select?.name || props['우선순위']?.rich_text?.[0]?.plain_text || '보통';
    const memo = props['메모']?.rich_text?.[0]?.plain_text || '';
    return { title, status, dueDate, priority, memo };
  }).filter(t => t.status !== '완료');
}

function calcDDay(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  return Math.ceil((due - today) / (1000 * 60 * 60 * 24));
}

function buildSlackMessage(tasks) {
  const today = new Date();
  const dateStr = `${today.getMonth() + 1}월 ${today.getDate()}일 (${['일','월','화','수','목','금','토'][today.getDay()]})`;

  const urgent = tasks.filter(t => {
    const d = calcDDay(t.dueDate);
    return d !== null && d <= 3;
  });

  const normal = tasks.filter(t => {
    const d = calcDDay(t.dueDate);
    return d === null || d > 3;
  });

  let text = `📋 *오늘의 업무 브리핑 (${dateStr})*\n\n`;

  if (urgent.length > 0) {
    text += `🔴 *마감 임박 (3일 이내)*\n`;
    urgent.forEach(t => {
      const d = calcDDay(t.dueDate);
      const label = d === 0 ? 'D-Day' : d < 0 ? `D+${Math.abs(d)}` : `D-${d}`;
      text += `• [${label}] ${t.title} - 마감 ${t.dueDate}\n`;
    });
    text += '\n';
  }

  if (normal.length > 0) {
    text += `📌 *진행 중 업무*\n`;
    normal.forEach(t => {
      const due = t.dueDate ? ` (~${t.dueDate})` : '';
      text += `• [${t.status}] ${t.title}${due}\n`;
    });
    text += '\n';
  }

  const inProgress = tasks.filter(t => t.status === '진행중').length;
  const notStarted = tasks.filter(t => t.status === '미시작').length;
  text += `✅ *현황:* 진행중 ${inProgress}건 / 미시작 ${notStarted}건`;

  return text;
}

async function sendSlack(text) {
  await httpsRequest({
    hostname: 'slack.com',
    path: '/api/chat.postMessage',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  }, { channel: SLACK_CHANNEL, text });
}

async function main() {
  const tasks = await fetchTasks();
  if (tasks.length === 0) {
    console.log('완료되지 않은 업무가 없습니다.');
    return;
  }
  const message = buildSlackMessage(tasks);
  console.log(message);
  await sendSlack(message);
  console.log('슬랙 전송 완료');
}

main().catch(err => { console.error(err); process.exit(1); });
