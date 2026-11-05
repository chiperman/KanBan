import { useState } from "react";

function unchanged<Value extends string>(value: Value): Value {
  return value;
}

export function useSourceSettingDraft<Value extends string>(
  receivedValue: Value,
  normalize: (value: Value) => Value = unchanged,
) {
  const [state, setState] = useState(() => ({
    receivedValue,
    savedValue: normalize(receivedValue),
    value: receivedValue,
    saved: false,
  }));

  if (state.receivedValue !== receivedValue) {
    const savedValue = normalize(receivedValue);
    // 重读更新未编辑的字段；已有草稿保留，并与最新服务端值比较。
    setState({
      receivedValue,
      savedValue,
      value: normalize(state.value) === state.savedValue ? receivedValue : state.value,
      saved: state.saved && state.savedValue === savedValue,
    });
  }

  function setValue(value: Value) {
    setState((current) => ({ ...current, value, saved: false }));
  }

  function markSaved(value: Value) {
    const savedValue = normalize(value);
    setState((current) => {
      // 请求期间收到不同的新值时，旧请求的完成反馈不覆盖它。
      if (current.receivedValue !== state.receivedValue &&
        normalize(current.receivedValue) !== savedValue) return current;
      return { ...current, value: savedValue, savedValue, saved: true };
    });
  }

  return {
    value: state.value,
    dirty: normalize(state.value) !== state.savedValue,
    saved: state.saved,
    setValue,
    markSaved,
  };
}
