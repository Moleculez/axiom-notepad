import { appearanceVariables, defaults } from "./appearance";
import {
  interfaceStyleIds,
  interfaceStyleVariables,
  legacyInterfaceStyleId,
} from "./interface-styles";
import { themePackIds } from "./theme-packs";

/** Public, account-free boot data generated from the same reviewed registries. */
export function appearanceBootScript(): string {
  const baseRecipe = interfaceStyleVariables("axiom");
  const initialVariables = (dark: boolean) =>
    Object.fromEntries(
      Object.entries(appearanceVariables(defaults, dark)).filter(
        ([key]) => !Object.hasOwn(baseRecipe, key),
      ),
    );
  const initial = {
    mode: defaults.mode,
    themePack: defaults.themePack,
    interfaceStyle: defaults.interfaceStyle,
    light: initialVariables(false),
    dark: initialVariables(true),
    motion: defaults.motion,
    density: defaults.density,
    focus: String(defaults.focusMode),
    documentDecorations: defaults.documentDecorations,
  };
  const recipes = Object.fromEntries(
    interfaceStyleIds.map((id) => [
      id,
      Object.fromEntries(
        Object.entries(interfaceStyleVariables(id)).filter(
          ([key, value]) => value !== baseRecipe[key],
        ),
      ),
    ]),
  );
  const identities = Object.fromEntries(
    interfaceStyleIds.flatMap((id) => {
      const old = legacyInterfaceStyleId(id, 11);
      return [[id, id], ...(old && old !== id ? [[old, id]] : [])];
    }),
  );
  // The cached variable map contains user typography/geometry and base colors.
  // Replace recipe roles from the registry so an older cache cannot defeat the
  // new recipe or flash an unrelated fallback before hydration completes.
  return `(function(){try{
  var initial=${JSON.stringify(initial)},d=initial,r=document.documentElement,
    baseRecipe=${JSON.stringify(baseRecipe)},recipes=${JSON.stringify(recipes)},identities=${JSON.stringify(identities)},
    s=null,c=null,pending=false;
  try{
    s=JSON.parse(localStorage.getItem('axiom:session')||'null');
    c=JSON.parse(localStorage.getItem('axiom:appearance')||'null');
    pending=!!localStorage.getItem('axiom:pending-signout');
  }catch(storageError){c=null;}
  if(c&&s&&s.user&&c.userId===s.user.id&&!pending)d=c;
  var dark=d.mode==='dark'||(d.mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  var style=Object.prototype.hasOwnProperty.call(identities,d.interfaceStyle)?identities[d.interfaceStyle]:'axiom';
  var recipe=Object.assign({},baseRecipe,recipes[style]),variables=dark?d.dark:d.light;
  r.dataset.theme=dark?'dark':'light';r.style.colorScheme=dark?'dark':'light';
  r.dataset.themePack=${JSON.stringify(themePackIds)}.includes(d.themePack)?d.themePack:'default';
  r.dataset.interfaceStyle=style;
  r.dataset.motion=['system','reduced','none'].includes(d.motion)?d.motion:initial.motion;
  r.dataset.density=['comfortable','compact'].includes(d.density)?d.density:initial.density;
  r.dataset.focus=d.focus==='true'?'true':'false';
  r.dataset.documentDecorations=d.documentDecorations==='latex'?'latex':'none';
  Object.entries(Object.assign({},recipe,variables&&typeof variables==='object'&&!Array.isArray(variables)?variables:{})).forEach(function(v){
    var value=Object.prototype.hasOwnProperty.call(recipe,v[0])?recipe[v[0]]:v[1];
    if(/^--[a-z-]+$/.test(v[0])&&typeof value==='string'&&!/url\\s*\\(|[<>]/i.test(value))r.style.setProperty(v[0],value);
  });
}catch(e){}})();`;
}
