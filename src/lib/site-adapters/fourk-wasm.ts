/** Isolated bindings for the public 4KVM request builder. No remote JS, browser globals or I/O imports. */
export function buildFourKRequest(module: WebAssembly.Module, data: {
  serverTime: string; pageTime: string; dataId: string; slug: string; userLink: string;
}): string {
  type Exports = { memory: WebAssembly.Memory; build_play_url: (...args: number[]) => void;
    __wbindgen_export: (size: number, align: number) => number;
    __wbindgen_export3: (ptr: number, size: number, align: number) => void;
    __wbindgen_add_to_stack_pointer: (n: number) => number; };
  // Bindings close over exports, initialized before the first call.
  // eslint-disable-next-line prefer-const
  let wasm: Exports;
  const heap: unknown[] = new Array(1024).fill(undefined);
  heap.push(undefined, null, true, false);
  const add = (value: unknown) => (heap.push(value), heap.length - 1);
  const read = (ptr: number, len: number) => new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, ptr, len));
  const put = (value: string): [number, number] => {
    const bytes = new TextEncoder().encode(value);
    const ptr = wasm.__wbindgen_export(bytes.length, 1);
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };
  const doc = { getElementById: (id: string) => id === 'nb-st' ? { content: data.serverTime } : id === 'nb-plt' ? { content: data.pageTime } : null };
  const win = { document: doc };
  const imports = {
    __wbg___wbindgen_is_undefined_52709e72fb9f179c: (i: number) => heap[i] === undefined,
    __wbg___wbindgen_throw_6ddd609b62940d55: () => { throw new Error('4K影视播放请求生成失败'); },
    __wbg_content_4373268a6f34e443: (out: number, i: number) => {
      const [ptr, len] = put((heap[i] as { content: string }).content);
      const view = new DataView(wasm.memory.buffer); view.setInt32(out, ptr, true); view.setInt32(out + 4, len, true);
    },
    __wbg_document_c0320cd4183c6d9b: () => add(doc),
    __wbg_getElementById_d1f25d287b19a833: (_i: number, ptr: number, len: number) => {
      const result = doc.getElementById(read(ptr, len)); return result ? add(result) : 0;
    },
    __wbg_instanceof_HtmlMetaElement_07f78901e9785572: (i: number) => !!heap[i] && 'content' in (heap[i] as object),
    __wbg_instanceof_Window_23e677d2c6843922: (i: number) => heap[i] === win,
    __wbg_now_16f0c993d5dd6c27: () => Date.now(),
    __wbg_static_accessor_GLOBAL_8adb955bd33fac2f: () => add(win),
    __wbg_static_accessor_GLOBAL_THIS_ad356e0db91c7913: () => add(win),
    __wbg_static_accessor_SELF_f207c857566db248: () => add(win),
    __wbg_static_accessor_WINDOW_bb9f1ba69d61b386: () => add(win),
    __wbindgen_object_clone_ref: (i: number) => add(heap[i]),
    __wbindgen_object_drop_ref: (i: number) => { if (i >= 1028) heap[i] = undefined; },
  };
  wasm = new WebAssembly.Instance(module, { './nbmovie_wasm_bg.js': imports }).exports as Exports;
  const out = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    wasm.build_play_url(out, ...put(data.dataId), ...put(data.slug), ...put('1080'), ...put(data.userLink));
    const view = new DataView(wasm.memory.buffer);
    const ptr = view.getInt32(out, true), len = view.getInt32(out + 4, true);
    const result = read(ptr, len); wasm.__wbindgen_export3(ptr, len, 1);
    if (!/^\/video\/play\?p=[\w%+=/&-]{1,2048}$/.test(result)) throw new Error('4K影视返回无效播放请求');
    return result;
  } finally { wasm.__wbindgen_add_to_stack_pointer(16); }
}
