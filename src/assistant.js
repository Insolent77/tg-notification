// Optional conversational layer. Task scheduling always stays in the deterministic backend.
const history=new Map();
export async function assistantReply(config,store,userText,sender=config.owner){
  if(!config.openaiApiKey)return null;
  const current=sender!==config.owner?[]:store.list().filter(t=>t.status==='active').slice(0,15).map(t=>({
    title:t.title,priority:t.priority,due_at:t.due_at,progress:t.progress_count,postponed:t.postponed_count,last_reason:t.last_reason
  }));
  const recent=sender!==config.owner?[]:store.recentEvents(30).map(e=>({action:e.action,reason:e.reason,task:e.title})).slice(0,15);
  const instructions=[
    'Ты личный секретарь одного человека. Отвечай по-русски, коротко, естественно, с умеренным юмором.',
    'Помогай расставлять приоритеты, начинать конкретные действия и честно оценивать, что сделано.',
    'Не стыди, не дави, не изображай психолога и не используй шаблонные мотивирующие фразы.',
    'Не утверждай, что задача создана, перенесена или выполнена: у тебя нет доступа к записи.',
    'Для фактических изменений предложи кнопки бота или Mini App.',
    'Не выдумывай данные и не делай выводов о привычках без повторяющихся примеров.',
    'Никаких лишних вступлений. Обычно достаточно 2–5 предложений.'
  ].join(' ');
  const previous=history.get(sender)||[];
  const input=[
    ...previous,
    {role:'user',content:'Мои актуальные задачи: '+JSON.stringify(current)+'\nПоследние действия: '+JSON.stringify(recent)+'\n\nМоё сообщение: '+userText.slice(0,1000)}
  ];
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',signal:controller.signal,
      headers:{'Authorization':'Bearer '+config.openaiApiKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:config.openaiModel,instructions,input,max_output_tokens:320,store:false})
    });
    if(!response.ok)throw new Error('OpenAI API returned '+response.status);
    const body=await response.json();
    const reply=(body.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
    if(!reply)throw new Error('OpenAI API response did not contain text');
    history.set(sender,[...previous,{role:'user',content:userText.slice(0,1000)},{role:'assistant',content:reply}].slice(-8));
    return reply;
  }finally{clearTimeout(timeout);}
}
