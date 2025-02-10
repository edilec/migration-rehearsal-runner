export const TOOL_ID='migration-rehearsal-runner';
export const LIMITS=Object.freeze({bytes:65536,tables:50,columns:100,steps:50,depth:16,milliseconds:5000});
const SEVERITY=Object.freeze({'input-unreadable':'warning','input-invalid':'warning','export-incomplete':'warning','rollback-unavailable':'warning','byte-limit':'warning','record-limit':'warning','depth-limit':'warning','time-limit':'warning','step-failed':'error','state-mismatch':'error','rollback-not-restored':'error'});
const MESSAGE=Object.freeze({'input-unreadable':'Rehearsal evidence could not be read.','input-invalid':'Rehearsal evidence is invalid or unsupported.','export-incomplete':'Rehearsal does not assert complete evidence.','rollback-unavailable':'Rollback steps are unavailable for verification.','byte-limit':'Rehearsal evidence exceeds its byte limit.','record-limit':'Rehearsal evidence exceeds a record limit.','depth-limit':'Rehearsal evidence exceeds JSON depth 16.','time-limit':'Simulation exceeded 5000 milliseconds.','step-failed':'A declared schema operation failed in the simulated state.','state-mismatch':'Simulated schema differs from the declared expected schema.','rollback-not-restored':'Rollback did not restore the post-setup schema.'});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const only=(x,keys)=>Object.keys(x).every(k=>keys.includes(k));
const id=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(x);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function finding(ruleId,pointer=''){if(!Object.hasOwn(SEVERITY,ruleId))throw Error('Unknown rule');return {ruleId,severity:SEVERITY[ruleId],message:MESSAGE[ruleId],location:{file:'@snapshot',pointer}};}
function report(findings,checked=0,failure=null,disposed=false){findings.sort((a,b)=>cmp(a.location.pointer,b.location.pointer)||cmp(a.ruleId,b.ruleId));const status=findings.some(x=>x.severity==='warning')?'incomplete':findings.some(x=>x.severity==='error')?'fail':'pass';return {schemaVersion:'1',tool:TOOL_ID,status,summary:{checked,errors:findings.filter(x=>x.severity==='error').length,warnings:findings.filter(x=>x.severity==='warning').length},failure:status==='fail'?failure:null,disposal:{scope:'simulated-memory-only',performed:disposed},findings};}
export const incomplete=ruleId=>report([finding(ruleId)]);
function inspect(value){const stack=[[value,0]];while(stack.length){const [item,depth]=stack.pop();if(depth>LIMITS.depth)return 'depth-limit';if(item&&typeof item==='object'){for(const [key,child] of Object.entries(item)){if(/^(databaseUrl|connectionString|dsn|jdbcUrl)$/i.test(key))return 'input-invalid';stack.push([child,depth+1]);}}else if(typeof item==='string'&&/(?:^|[^A-Za-z0-9_])(?:(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|mssql|sqlserver|oracle|sqlite):\/\/|jdbc:)/i.test(item))return 'input-invalid';}return null;}
function schema(value){if(!object(value)||!only(value,['tables'])||!Array.isArray(value.tables))return {error:'input-invalid'};if(value.tables.length>LIMITS.tables)return {error:'record-limit'};const tables=new Map();for(const item of value.tables){if(!object(item)||!only(item,['name','columns'])||!id(item.name)||!Array.isArray(item.columns)||item.columns.length<1)return {error:'input-invalid'};if(item.columns.length>LIMITS.columns)return {error:'record-limit'};if(item.columns.some(x=>!id(x))||new Set(item.columns).size!==item.columns.length||tables.has(item.name))return {error:'input-invalid'};tables.set(item.name,new Set(item.columns));}return {tables};}
function equal(a,b){if(a.size!==b.size)return false;for(const [name,cols] of a){const other=b.get(name);if(!other||other.size!==cols.size||[...cols].some(x=>!other.has(x)))return false;}return true;}
function validStep(item,phase){if(!object(item))return false;if(phase==='setup')return only(item,['action','table','columns'])&&item.action==='create-table'&&id(item.table)&&Array.isArray(item.columns)&&item.columns.length>0&&item.columns.every(id)&&new Set(item.columns).size===item.columns.length;if(!only(item,['action','table','column'])||!id(item.table)||!id(item.column))return false;return phase==='forward'?item.action==='add-column':item.action==='remove-column';}
function apply(tables,item){if(item.action==='create-table'){if(tables.has(item.table))return false;tables.set(item.table,new Set(item.columns));return true;}const cols=tables.get(item.table);if(!cols)return false;if(item.action==='add-column'){if(cols.has(item.column))return false;cols.add(item.column);return true;}if(!cols.has(item.column)||cols.size===1)return false;cols.delete(item.column);return true;}

export function rehearse(snapshot,{now=()=>performance.now()}={}){
  const start=now(),timed=()=>now()-start>LIMITS.milliseconds;
  const inspected=inspect(snapshot);if(inspected)return incomplete(inspected);
  if(!object(snapshot)||!only(snapshot,['schemaVersion','complete','fixture','steps','expected','metadata'])||snapshot.schemaVersion!=='1'||snapshot.complete!==true||!object(snapshot.steps)||!only(snapshot.steps,['setup','forward','rollback'])||!object(snapshot.expected)||!only(snapshot.expected,['afterSetup','afterForward','afterRollback']))return incomplete(snapshot?.complete===false?'export-incomplete':'input-invalid');
  const phases=['setup','forward','rollback'];for(const phase of phases)if(!Array.isArray(snapshot.steps[phase]))return incomplete('input-invalid');
  if(snapshot.steps.forward.length===0)return incomplete('export-incomplete');
  if(snapshot.steps.rollback.length===0)return incomplete('rollback-unavailable');
  if(phases.some(phase=>snapshot.steps[phase].length>LIMITS.steps))return incomplete('record-limit');
  const initial=schema(snapshot.fixture),expected=phases.map(phase=>schema(snapshot.expected[`after${phase[0].toUpperCase()}${phase.slice(1)}`]));
  if(initial.error)return incomplete(initial.error);for(const item of expected)if(item.error)return incomplete(item.error);
  for(const phase of phases)for(const item of snapshot.steps[phase]){if(timed())return incomplete('time-limit');if(!validStep(item,phase))return incomplete('input-invalid');if(item.action==='create-table'&&item.columns.length>LIMITS.columns)return incomplete('record-limit');}
  if(timed())return incomplete('time-limit');
  const state=new Map([...initial.tables].map(([name,cols])=>[name,new Set(cols)]));let checked=0;
  for(const [index,phase] of phases.entries()){
    for(const [i,item] of snapshot.steps[phase].entries()){
      if(timed())return report([finding('time-limit')],checked,null,true);
      const pointer=`/steps/${phase}/${i}`;
      if(!apply(state,item))return report([finding('step-failed',pointer)],checked+1,{phase,step:pointer},true);
      checked++;
      if(state.size>LIMITS.tables||[...state.values()].some(cols=>cols.size>LIMITS.columns))return report([finding('record-limit',pointer)],checked,null,true);
    }
    if(!equal(state,expected[index].tables))return report([finding('state-mismatch',`/expected/after${phase[0].toUpperCase()}${phase.slice(1)}`)],checked,{phase,step:null},true);
  }
  if(timed())return report([finding('time-limit')],checked,null,true);
  if(!equal(state,expected[0].tables))return report([finding('rollback-not-restored','/expected/afterRollback')],checked,{phase:'rollback',step:null},true);
  return report([],checked,null,true);
}
