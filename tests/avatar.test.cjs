const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { AvatarEditorStore } = require('../.expo/avatar-tests/features/profile/avatarEditorState.js');
const { ApiClient } = require('../.expo/avatar-tests/api/client.js');
const { ApiClientError } = require('../.expo/avatar-tests/api/errors.js');
const { createTranslator } = require('../.expo/avatar-tests/i18n/translations.js');

const avatar = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', width: 512, height: 512, mimeType: 'image/jpeg' };
const picked = { uri: 'blob:fixture-photo', file: new Blob(['photo'], { type: 'image/png' }), mimeType: 'image/png', width: 900, height: 700, fileSize: 5 };
const profile = { id: 'user-a', avatar: null, displayName: 'Person', handle: 'person', extroversionLevel: 5.5, city: null, countryCode: null, bio: null };
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
async function flush() { for(let i=0;i<30;i++) await Promise.resolve(); }
const response = (status, body) => new Response(JSON.stringify(body), { status, headers: {'Content-Type':'application/json'} });
const authResponse = (user=profile) => ({user,accessToken:'access',refreshToken:'refresh',tokenType:'Bearer',accessTokenExpiresIn:900});
function client(fetchImpl) { let value=null; return new ApiClient({baseUrl:()=> 'http://api.test:9000/api/v1',fetchImpl,refreshTokenStorage:{async get(){return value},async set(v){value=v},async clear(){value=null}}}); }
function host(auth) {
  const slots=[]; let cursor=0, effects=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v}]},
    useMemo(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value},
    useRef(initial){return react.useMemo(()=>({current:initial}),[])},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const cleanup=slots[i]?.cleanup;slots[i]={deps};effects.push(()=>{cleanup?.();slots[i].cleanup=fn()})}},
    useSyncExternalStore(_,get){return get()},
  };
  const jsx=(type,props)=>({type,props});
  function load(file,extra={}, expose='') {
    const exports={}, native=Object.fromEntries(['View','Text','Pressable','Image','ScrollView','Modal','ActivityIndicator','TextInput','KeyboardAvoidingView'].map(x=>[x,x]));
    const mocks={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'react-native':{...native,StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:400}),AccessibilityInfo:{announceForAccessibility(){}},Alert:{alert(){}},Platform:{OS:'web'}},
      '@expo/vector-icons':{Feather:'Feather'},'../../theme':{colors:{},radius:{}},'../../auth/AuthProvider':{useAuthenticatedAuth:()=>auth},
      '../../i18n/LocalizationProvider':{useI18n:()=>({t:createTranslator('ru')})},'./avatarEditorState':{AvatarEditorStore},'./AvatarImage':{AvatarImage:'AvatarImage'},...extra};
    vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname,'..',file),'utf8')+(expose?`\nexports.${expose}=${expose};`:''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,
      {exports,require(n){if(n in mocks)return mocks[n];throw Error('Unexpected dependency '+n)}},{filename:file}); return exports;
  }
  function render(fn){cursor=0;const tree=fn();for(const f of effects.splice(0))f();return tree}
  function find(node,id){if(Array.isArray(node))return node.map(n=>find(n,id)).find(Boolean);if(!node||typeof node!=='object')return;return (typeof id==='function'?id(node):node.props?.testID===id)?node:find(node.props?.children,id)}
  return {load,render,find,unmount(){for(const slot of slots)slot?.cleanup?.()}};
}
function editor(actions={}, language='ru') {
  const auth={user:{...profile},storageRecoveryRequired:false,uploadAvatar:async()=>avatar,refreshAvatar:async()=>null,removeAvatar:async()=>true,...actions};
  const h=host(auth);let closed=0;
  const {AvatarEditor}=h.load('src/features/profile/AvatarEditor.tsx',{'expo-image-picker':{launchImageLibraryAsync:actions.pick??(async()=>({canceled:false,assets:[picked]}))},
    '../../i18n/LocalizationProvider':{useI18n:()=>({t:createTranslator(language)})}});
  const render=()=>h.render(()=>AvatarEditor({onClose(){closed++}}));render();
  return {...h,auth,render,closed:()=>closed};
}

test('actual avatar editor discloses public use, selects one library image, previews then discards without upload',async()=>{
  let calls=0,options;
  const h=editor({uploadAvatar:async()=>{calls++;return avatar},pick:async o=>{options=o;return{canceled:false,assets:[picked]}}});
  assert.ok(h.find(h.render(),n=>n.type==='Text'&&String(n.props.children).includes('публичный')));
  await h.find(h.render(),'avatar-pick').props.onPress();await flush();
  assert.deepEqual(Array.from(options.mediaTypes),['images']);assert.equal(options.allowsMultipleSelection,false);assert.equal(options.exif,false);
  assert.equal(h.find(h.render(),'avatar-preview').props.source.uri,picked.uri);
  h.find(h.render(),'avatar-discard').props.onPress();assert.equal(h.find(h.render(),'avatar-preview'),undefined);assert.equal(calls,0);
  h.find(h.render(),'avatar-close').props.onPress();assert.equal(h.closed(),1);
});

test('picker cancellation, permission failure, unsupported format and input limits never upload',async()=>{
  for(const outcome of [{canceled:true,assets:null},{error:true},{canceled:false,assets:[{...picked,mimeType:'image/heic'}]},
    {canceled:false,assets:[{...picked,fileSize:5*1024*1024+1}]},{canceled:false,assets:[{...picked,width:5000,height:5000}]}]){
    let uploads=0;const h=editor({pick:async()=>{if(outcome.error)throw Error('permissions');return outcome},uploadAvatar:async()=>{uploads++;return avatar}});
    h.find(h.render(),'avatar-pick').props.onPress();await flush();assert.equal(uploads,0);assert.equal(h.find(h.render(),'avatar-preview'),undefined);
    assert.equal(!!h.find(h.render(),'avatar-error'),!outcome.canceled);h.unmount();
  }
});

test('confirmed upload is single-flight; errors retain draft/old avatar and reload never pretends success',async()=>{
  const pending=deferred();let sends=0,reads=0,confirmed=null;
  const h=editor({uploadAvatar:async(input,current)=>{sends++;await pending.promise;if(current())confirmed=avatar;return avatar},refreshAvatar:async()=>{reads++;return avatar}});
  h.find(h.render(),'avatar-pick').props.onPress();await flush();
  const submit=h.find(h.render(),'avatar-upload').props.onPress;submit();submit();await flush();assert.equal(sends,1);assert.equal(confirmed,null);
  assert.equal(h.find(h.render(),'avatar-pick').props.disabled,true);assert.equal(h.find(h.render(),'avatar-upload').props.disabled,true);
  pending.reject(new ApiClientError({code:'NETWORK_ERROR',statusCode:0,message:'fixture'}));await flush();
  assert.ok(h.find(h.render(),'avatar-preview'));assert.ok(h.find(h.render(),'avatar-error'));assert.equal(h.find(h.render(),'avatar-saved'),undefined);assert.equal(confirmed,null);
  h.find(h.render(),'avatar-refresh').props.onPress();await flush();assert.equal(reads,1);assert.ok(h.find(h.render(),'avatar-checked'));assert.equal(h.find(h.render(),'avatar-saved'),undefined);
  // Fresh owner after a deliberate choice/attempt, not automatic retry.
  h.auth.uploadAvatar=async()=>{sends++;return avatar};h.render();h.find(h.render(),'avatar-pick').props.onPress();await flush();h.find(h.render(),'avatar-upload').props.onPress();await flush();
  assert.equal(sends,2);assert.ok(h.find(h.render(),'avatar-saved'));assert.equal(h.find(h.render(),'avatar-preview'),undefined);
});

test('late picker, upload and profile read after close/unmount/account switch cannot publish',async()=>{
  for(const operation of ['pick','upload','read'])for(const transition of ['close','unmount','account','logout']){
    const wait=deferred();let applied=0;
    const h=editor({pick:async()=>operation==='pick'?wait.promise:{canceled:false,assets:[picked]},
      uploadAvatar:async(_,valid)=>{await wait.promise;if(valid())applied++;return avatar},refreshAvatar:async valid=>{await wait.promise;if(valid())applied++;return avatar}});
    if(operation==='upload'){h.find(h.render(),'avatar-pick').props.onPress();await flush();}
    h.find(h.render(),`avatar-${operation==='read'?'refresh':operation}`).props.onPress();await flush();
    if(transition==='close')h.find(h.render(),'avatar-close').props.onPress();
    else if(transition==='unmount')h.unmount();else {if(transition==='account')h.auth.user={...profile,id:'user-b'};else h.auth.storageRecoveryRequired=true;h.render();}
    wait.resolve(operation==='pick'?{canceled:false,assets:[picked]}:avatar);await flush();assert.equal(applied,0);
    assert.equal(h.find(h.render(),'avatar-saved'),undefined);assert.equal(h.find(h.render(),'avatar-preview'),undefined);
  }
});

test('actual avatar image uses configured public URL, neutral missing/error fallback, recovers for a new id',()=>{
  const h=host({user:profile,avatarReloadKey:'',getAvatarUrl:id=>`http://actual-api:9000/api/v1/media/avatars/${id}`});const {AvatarImage}=h.load('src/features/profile/AvatarImage.tsx');
  const render=value=>h.render(()=>AvatarImage({avatar:value}));assert.ok(h.find(render(null),'profile-avatar-placeholder'));
  const image=h.find(render(avatar),'profile-avatar-image');assert.equal(image.props.source.uri,`http://actual-api:9000/api/v1/media/avatars/${avatar.id}`);
  image.props.onError();assert.ok(h.find(render(avatar),'profile-avatar-placeholder'));
  assert.ok(h.find(render({...avatar,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),'profile-avatar-image'));
});

test('member-local opaque image retry recovers same id without changing profile retry or reading users/me',()=>{
  const auth={user:profile,avatarReloadKey:'profile-attempt',getAvatarUrl:id=>`http://api.test/api/v1/media/avatars/${id}`};
  const h=host(auth);const {AvatarImage}=h.load('src/features/profile/AvatarImage.tsx');
  let reloadKey='00000000-0000-4000-8000-000000000001';
  const render=()=>h.render(()=>AvatarImage({avatar,reloadKey}));
  const old=h.find(render(),'profile-avatar-image'); old.props.onError();
  for(let i=0;i<3;i++)assert.ok(h.find(render(),'profile-avatar-placeholder'));
  reloadKey='00000000-0000-4000-8000-000000000002';
  const fresh=h.find(render(),'profile-avatar-image'); assert.equal(new URL(fresh.props.source.uri).searchParams.get('retry'),reloadKey);
  assert.ok(!fresh.props.source.uri.includes(profile.id)); old.props.onError(); assert.ok(h.find(render(),'profile-avatar-image'));
  fresh.props.onError();assert.ok(h.find(render(),'profile-avatar-placeholder'));
  reloadKey='00000000-0000-4000-8000-000000000003';assert.ok(h.find(render(),'profile-avatar-image'));
  assert.equal(auth.avatarReloadKey,'profile-attempt'); h.unmount();
});

test('manual same-id retry reloads profile/editor/nav images; failures never auto-loop or affect another account',async()=>{
  const auth={user:{...profile,avatar},avatarReloadKey:'',getAvatarUrl:id=>`http://api.test/api/v1/media/avatars/${id}`};
  // Three actual independent AvatarImage instances, just as Profile, editor and BottomNav mount them.
  const surfaces=[94,64,28].map(size=>{const h=host(auth);const {AvatarImage}=h.load('src/features/profile/AvatarImage.tsx');return{...h,render:()=>h.render(()=>AvatarImage({avatar:auth.user.avatar,size}))}});
  const failedCallbacks=surfaces.map(h=>h.find(h.render(),'profile-avatar-image').props.onError);
  failedCallbacks.forEach(fn=>fn());
  for(const h of surfaces)for(let i=0;i<3;i++)assert.ok(h.find(h.render(),'profile-avatar-placeholder'));
  // The real editor's manual GET succeeds with the same id and broadcasts one new attempt.
  const h=editor({user:auth.user,refreshAvatar:async valid=>{if(valid())auth.avatarReloadKey='1:1';return avatar}});
  h.find(h.render(),'avatar-refresh').props.onPress();await flush();
  assert.ok(h.find(h.render(),'avatar-checked'));assert.equal(h.find(h.render(),'avatar-saved'),undefined);
  for(const surface of surfaces){
    const image=surface.find(surface.render(),'profile-avatar-image');assert.equal(image.props.source.uri,`http://api.test/api/v1/media/avatars/${avatar.id}?retry=1%3A1`);
    image.props.onError();assert.ok(surface.find(surface.render(),'profile-avatar-placeholder'));
  }
  // Late errors from the first attempt cannot overwrite the new failure and implicitly retry it.
  failedCallbacks.forEach(fn=>fn());
  for(const surface of surfaces)assert.ok(surface.find(surface.render(),'profile-avatar-placeholder'));
  auth.avatarReloadKey='1:2';
  const oldErrors=surfaces.map(surface=>surface.find(surface.render(),'profile-avatar-image').props.onError);
  auth.user={...profile,id:'user-b',avatar};auth.avatarReloadKey='';
  for(const surface of surfaces)assert.ok(surface.find(surface.render(),'profile-avatar-image'));
  oldErrors.forEach(fn=>fn());
  for(const surface of surfaces)assert.ok(surface.find(surface.render(),'profile-avatar-image'));
});

test('actual Profile exposes the separate avatar editor with real identity and keeps gallery demo-labelled',()=>{
  const auth={user:{...profile},storageRecoveryRequired:false};const h=host(auth);
  const {ProfileScreen}=h.load('src/screens/ProfileScreen.tsx',{
    '@react-native-community/slider':'Slider','expo-linear-gradient':{LinearGradient:'LinearGradient'},
    '../api/errorMessages':{getRequestErrorTranslationKey:()=> 'avatar.uploadUnconfirmed'},'../assets':{photos:{}},
    '../auth/AuthProvider':{useAuthenticatedAuth:()=>auth},'../components/Primitives':{IconButton:'IconButton'},'../components/Screen':{Screen:'Screen'},
    '../features/profile/ExtroversionGauge':{ExtroversionGauge:'Gauge'},'../features/profile/extroversion':{getExtroversionBand:()=> 'ambivert',getExtroversionVisual:()=>({color:'blue'}),normalizeExtroversionLevel:v=>v},
    '../features/profile/ProfileEditModal':{ProfileEditModal:'ProfileEditModal'},'../features/profile/AvatarImage':{AvatarImage:'AvatarImage'},'../features/profile/AvatarEditor':{AvatarEditor:'AvatarEditor'},
    '../features/profile/ProfileLobbyHistory':{LobbyHistory:'LobbyHistory'},
    '../features/profile/saveExtroversion':{},'../i18n/LocalizationProvider':{useI18n:()=>({t:createTranslator('ru')})},'../theme':{colors:{},radius:{}},
  });
  const render=()=>h.render(()=>ProfileScreen());
  assert.equal(h.find(render(),n=>n.type==='AvatarImage').props.avatar,null);
  assert.ok(h.find(render(),n=>n.type==='Text'&&n.props.children===createTranslator('ru')('lobbies.demoProfile')));
  h.find(render(),'change-avatar').props.onPress();assert.ok(h.find(render(),n=>n.type==='AvatarEditor'));
  auth.user={...profile,avatar};assert.equal(h.find(render(),n=>n.type==='AvatarImage').props.avatar,avatar);
  auth.user={...auth.user,avatar:null};assert.equal(h.find(render(),n=>n.type==='AvatarImage').props.avatar,null);
  h.find(render(),n=>n.type==='AvatarEditor').props.onClose();assert.equal(h.find(render(),n=>n.type==='AvatarEditor'),undefined);
});

test('actual text profile editor retains unsaved draft across independent avatar and level updates',()=>{
  const h=host({updateProfile:async()=>profile});
  const {ProfileEditModal}=h.load('src/features/profile/ProfileEditModal.tsx',{
    '../../api/errorMessages':{getRequestErrorTranslationKey:()=> 'avatar.uploadUnconfirmed'},'../../theme':{colors:{},radius:{},shadows:{}},
  });
  const render=p=>h.render(()=>ProfileEditModal({visible:true,profile:p,onClose(){}}));
  const name=tree=>h.find(tree,n=>n.props?.label===createTranslator('ru')('auth.displayName'));
  render(profile);name(render(profile)).props.onChangeText('Unsaved name');
  assert.equal(name(render({...profile,avatar,extroversionLevel:9})).props.value,'Unsaved name');
  render({...profile,id:'user-b',displayName:'Other account'});
  assert.equal(name(render({...profile,id:'user-b',displayName:'Other account'})).props.value,'Other account');
});

test('multipart transport rebuilds usable body once after explicit 401 and leaves boundary to fetch',async()=>{
  const bodies=[],headers=[];let refreshes=0;
  const api=client(async(url,init)=>{
    if(url.endsWith('/login'))return response(200,authResponse());
    if(url.endsWith('/refresh')){refreshes++;return response(200,{...authResponse(),accessToken:'next-access'})}
    bodies.push(init.body);headers.push(init.headers);
    return bodies.length===1?response(401,{error:{code:'INVALID_ACCESS_TOKEN',message:'expired'}}):response(200,{avatar});
  });
  await api.login({email:'fixture',password:'fixture'});assert.deepEqual(await api.uploadAvatar(picked),avatar);
  assert.equal(refreshes,1);assert.equal(bodies.length,2);assert.notEqual(bodies[0],bodies[1]);
  for(const body of bodies){assert.ok(body instanceof FormData);assert.equal(await body.get('file').text(),'photo');assert.deepEqual([...body.keys()],['file'])}
  assert.ok(headers.every(h=>!('Content-Type'in h)));assert.equal(headers[1].Authorization,'Bearer next-access');
  assert.equal(api.getAvatarUrl(avatar.id),`http://api.test:9000/api/v1/media/avatars/${avatar.id}`);
});

test('uncertain upload never auto-retries; invalid receipts fail closed and late session responses are rejected',async()=>{
  for(const failure of ['network',500,'json','shape',401]){
    let uploads=0,refreshes=0;const api=client(async(url)=>{if(url.endsWith('/login'))return response(200,authResponse());if(url.endsWith('/refresh')){refreshes++;return response(200,authResponse())}uploads++;
      if(failure==='network')throw Error('offline');if(failure==='json')return new Response('not-json',{status:200});if(failure==='shape')return response(200,{avatar:{id:avatar.id}});return response(failure,{error:{code:failure===401?'INVALID_ACCESS_TOKEN':'INTERNAL_SERVER_ERROR',message:'fixture'}})});
    await api.login({});await assert.rejects(api.uploadAvatar(picked));assert.equal(uploads,failure===401?2:1);assert.equal(refreshes,failure===401?1:0);
  }
  const late=deferred();const api=client(async(url)=>url.endsWith('/avatar')?late.promise:response(200,authResponse()));
  await api.login({});const pending=api.uploadAvatar(picked);await flush();await api.login({});late.resolve(response(200,{avatar}));await assert.rejects(pending,e=>e.code==='INVALID_REFRESH_TOKEN');
});

test('conditional DELETE keeps its exact target, validates null-only receipt and uses bounded auth retry',async()=>{
  for(const outcome of ['ok','expired','network',500,'json',{},[],null,{avatar},{avatar:null,extra:true},401]){
    let deletes=0,rotations=0;
    const api=client(async(url,init)=>{
      if(url.endsWith('/login'))return response(200,authResponse({...profile,avatar}));
      if(url.endsWith('/refresh')){rotations++;return response(200,{...authResponse(),accessToken:'next'})}
      assert.equal(new URL(url).pathname,`/api/v1/users/me/avatar/${avatar.id}`);assert.equal(new URL(url).search,'');
      assert.equal(init.method,'DELETE');assert.equal(init.body,undefined);deletes++;
      if(outcome==='expired'&&deletes===1||outcome===401)return response(401,{error:{code:'INVALID_ACCESS_TOKEN',message:'expired'}});
      if(outcome==='network')throw Error('offline');if(outcome===500)return response(500,{error:{code:'INTERNAL_SERVER_ERROR',message:'fixture'}});
      if(outcome==='json')return new Response('invalid',{status:200});
      return response(200,outcome==='ok'||outcome==='expired'?{avatar:null}:outcome);
    });
    await api.login({});
    if(outcome==='ok'||outcome==='expired')await api.removeAvatar(avatar.id);else await assert.rejects(api.removeAvatar(avatar.id));
    assert.equal(deletes,outcome==='expired'||outcome===401?2:1);assert.equal(rotations,outcome==='expired'||outcome===401?1:0);
  }
});

test('actual editor removal confirms or declines separately from local draft, with one shared busy gate',async()=>{
  for(const language of ['ru','en']){
    const pending=deferred();let sends=0,picks=0,reads=0,uploads=0;
    const h=editor({user:{...profile,avatar},pick:async()=>{picks++;return{canceled:false,assets:[picked]}},
      refreshAvatar:async()=>{reads++;return avatar},uploadAvatar:async()=>{uploads++;return avatar},
      removeAvatar:async(id,current)=>{assert.equal(id,avatar.id);sends++;await pending.promise;if(current())h.auth.user={...h.auth.user,avatar:null};return current()}},language);
    h.find(h.render(),'avatar-pick').props.onPress();await flush();
    const pick=h.find(h.render(),'avatar-pick').props.onPress,upload=h.find(h.render(),'avatar-upload').props.onPress,refresh=h.find(h.render(),'avatar-refresh').props.onPress;
    h.find(h.render(),'avatar-remove').props.onPress();assert.ok(h.find(h.render(),'avatar-remove-confirmation'));assert.equal(sends,0);
    const oldConfirm=h.find(h.render(),'avatar-remove-confirm').props.onPress;
    h.find(h.render(),'avatar-keep').props.onPress();oldConfirm();await flush();assert.equal(sends,0);assert.ok(h.find(h.render(),'avatar-preview'));
    h.find(h.render(),'avatar-remove').props.onPress();oldConfirm();assert.equal(sends,0);
    const confirm=h.find(h.render(),'avatar-remove-confirm').props.onPress;confirm();confirm();pick();upload();refresh();await flush();
    assert.equal(sends,1);assert.equal(picks,1);assert.equal(uploads,0);assert.equal(reads,0);assert.equal(h.find(h.render(),'avatar-removed'),undefined);
    pending.resolve();await flush();assert.equal(h.find(h.render(),n=>n.type==='AvatarImage').props.avatar,null);
    assert.ok(h.find(h.render(),'avatar-preview'));assert.equal(h.find(h.render(),'avatar-saved'),undefined);
    assert.equal(h.find(h.render(),'avatar-removed').props.children,createTranslator(language)('avatar.removed'));
    assert.equal(h.auth.user.displayName,profile.displayName);assert.equal(h.auth.user.extroversionLevel,profile.extroversionLevel);
    confirm();await flush();assert.equal(sends,1);h.unmount();
  }
});

test('uncertain removal retains A through GET null or B; no false receipt, no automatic retarget or retry',async()=>{
  for(const replaced of [false,true]){
    const next={...avatar,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},targets=[];let current=avatar;
    const h=editor({user:{...profile,avatar},removeAvatar:async id=>{
      targets.push(id);if(targets.length===1){current=replaced?next:null;throw new ApiClientError({code:'NETWORK_ERROR',statusCode:0,message:'lost'})}
      if(current&&current.id!==id)throw new ApiClientError({code:'AVATAR_CHANGED',statusCode:409,message:'changed'});
      current=null;h.auth.user={...h.auth.user,avatar:null};return true;
    },refreshAvatar:async()=>{h.auth.user={...h.auth.user,avatar:current};return current}});
    h.find(h.render(),'avatar-remove').props.onPress();h.find(h.render(),'avatar-remove-confirm').props.onPress();await flush();
    assert.ok(h.find(h.render(),'avatar-remove-error'));assert.equal(h.find(h.render(),'avatar-removed'),undefined);
    h.find(h.render(),'avatar-refresh').props.onPress();await flush();assert.ok(h.find(h.render(),'avatar-checked'));
    assert.equal(h.find(h.render(),'avatar-removed'),undefined);assert.equal(targets.length,1);
    h.find(h.render(),'avatar-remove-retry').props.onPress();await flush();assert.deepEqual(targets,[avatar.id,avatar.id]);
    if(replaced){
      assert.equal(h.auth.user.avatar.id,next.id);assert.equal(h.find(h.render(),'avatar-removed'),undefined);assert.equal(h.find(h.render(),'avatar-remove-retry'),undefined);
      assert.equal(h.find(h.render(),'avatar-remove-error').props.children,createTranslator('ru')('avatar.changed'));
      h.find(h.render(),'avatar-refresh').props.onPress();await flush();assert.equal(targets.length,2);
      h.find(h.render(),'avatar-remove').props.onPress();assert.equal(targets.length,2);
      h.find(h.render(),'avatar-remove-confirm').props.onPress();await flush();assert.equal(targets[2],next.id);
    }
    assert.ok(h.find(h.render(),'avatar-removed'));h.unmount();
  }
});

test('pick/read/upload synchronously block stale remove confirmation and preserve the frozen target',async()=>{
  for(const operation of ['pick','upload','read']){
    const pending=deferred();let removed=0;
    const store=new AvatarEditorStore({pick:()=>operation==='pick'?pending.promise:Promise.resolve(picked),upload:()=>pending.promise,refresh:()=>pending.promise,remove:async()=>{removed++;return true}});
    store.setContext('A');if(operation==='upload')await store.choose();
    const flight=operation==='pick'?store.choose():operation==='upload'?store.upload():store.refresh();
    store.requestRemoval(avatar.id);assert.equal(store.getSnapshot().removal,null);assert.equal(removed,0);
    pending.resolve(operation==='pick'?picked:avatar);await flight;
    store.requestRemoval(avatar.id);const target=store.getSnapshot().removal;store.setContext('B');await store.remove(target);
    assert.equal(removed,0);assert.equal(store.getSnapshot().removal,null);
  }
});

test('late removal success/error and stale UI handlers are ignored after close/reopen/account/recovery/unmount',async()=>{
  for(const transition of ['close','account','recovery','unmount'])for(const fails of [false,true]){
    const pending=deferred();let applied=0,calls=0;
    const h=editor({user:{...profile,avatar},removeAvatar:async(_,valid)=>{calls++;await pending.promise;if(valid())applied++;return valid()}});
    const oldRemove=h.find(h.render(),'avatar-remove').props.onPress;
    oldRemove();const confirm=h.find(h.render(),'avatar-remove-confirm').props.onPress;confirm();
    if(transition==='close')h.find(h.render(),'avatar-close').props.onPress();else if(transition==='unmount')h.unmount();
    else{if(transition==='account')h.auth.user={...profile,id:'B',avatar};else h.auth.storageRecoveryRequired=true;h.render()}
    oldRemove();confirm();assert.equal(calls,1);
    if(fails)pending.reject(Error('late error'));else pending.resolve();await flush();
    assert.equal(applied,0);assert.equal(h.find(h.render(),'avatar-removed'),undefined);assert.equal(h.find(h.render(),'avatar-remove-error'),undefined);h.unmount();
    const reopened=editor({user:{...profile,avatar}});assert.equal(reopened.find(reopened.render(),'avatar-remove-retry'),undefined);reopened.unmount();
  }
});

test('confirmed removal propagates null to actual editor/nav consumers and all three AvatarImage instances',async()=>{
  const h=editor({user:{...profile,avatar},removeAvatar:async(_,valid)=>{if(valid())h.auth.user={...h.auth.user,avatar:null};return valid()}});
  const navHost=host(h.auth),nav=navHost.load('src/components/BottomNav.tsx',{
    'react-native':{StyleSheet:{create:x=>x},Platform:{select:x=>x.web}},'@expo/vector-icons':{},
    '../auth/AuthProvider':{useAuthenticatedAuth:()=>h.auth},'../features/profile/AvatarImage':{AvatarImage:'AvatarImage'},
    '../i18n/LocalizationProvider':{},'../navigation/useNavPulse':{},'../navigation/navMotion':navHost.load('src/navigation/navMotion.ts'),
    '../theme':{colors:{}},'./GlassNavSurface':{},'./NavPressGlint':{},'./NavActiveIndicator':{},'../features/activity/UnreadNotificationsProvider':{},
  },'ProfileNavAvatar');
  h.auth.getAvatarUrl=id=>`http://api.test/api/v1/media/avatars/${id}`;
  const surfaces=[94,64,28].map(size=>{const s=host(h.auth),{AvatarImage}=s.load('src/features/profile/AvatarImage.tsx');return{...s,render:()=>s.render(()=>AvatarImage({avatar:h.auth.user.avatar,size}))}});
  for(const s of surfaces)assert.ok(s.find(s.render(),'profile-avatar-image'));
  assert.equal(navHost.render(nav.ProfileNavAvatar).props.avatar.id,avatar.id);
  h.find(h.render(),'avatar-remove').props.onPress();h.find(h.render(),'avatar-remove-confirm').props.onPress();await flush();
  assert.ok(h.find(h.render(),'avatar-removed'));assert.equal(h.find(h.render(),n=>n.type==='AvatarImage').props.avatar,null);
  assert.equal(navHost.render(nav.ProfileNavAvatar).props.avatar,null);
  for(const s of surfaces){assert.ok(s.find(s.render(),'profile-avatar-placeholder'));assert.equal(s.find(s.render(),'profile-avatar-image'),undefined);s.unmount()}
  h.unmount();navHost.unmount();
});

test('avatar error codes have RU/EN messages; reload error is retryable without changing confirmed state',async()=>{
  for(const code of ['AVATAR_TOO_LARGE','AVATAR_PIXEL_LIMIT','AVATAR_UNSUPPORTED_FORMAT','AVATAR_INVALID_IMAGE','VALIDATION_FAILED','AVATAR_STORAGE_UNAVAILABLE']){
    const store=new AvatarEditorStore({pick:async()=>picked,upload:async()=>{throw new ApiClientError({code,statusCode:400,message:'fixture'})},refresh:async()=>{throw Error('offline')}});
    store.setContext('a');await store.choose();await store.upload();assert.ok(store.getSnapshot().draft);for(const lang of ['ru','en'])assert.ok(createTranslator(lang)(store.getSnapshot().error));
    await store.refresh();assert.equal(store.getSnapshot().error,'avatar.readError');assert.equal(store.getSnapshot().busy,null);
  }
});
