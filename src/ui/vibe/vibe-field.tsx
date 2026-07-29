import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

interface VibeFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> {
  fieldId: string;
  label: string;
  ref?: Ref<HTMLInputElement>;
}

export function VibeField({ fieldId, label, ref, ...inputProps }: VibeFieldProps) {
  return (
    <label
      className="vibe-field"
      data-testid={`vibe-field-${fieldId}`}
      data-vibe-component="field"
      htmlFor={fieldId}
    >
      <span className="vibe-field__label">{label}</span>
      <input ref={ref} className="vibe-field__input" id={fieldId} {...inputProps} />
    </label>
  );
}

interface VibeSelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "id"> {
  children: ReactNode;
  fieldId: string;
  label: string;
}

export function VibeSelectField({
  children,
  fieldId,
  label,
  ...selectProps
}: VibeSelectFieldProps) {
  return (
    <label className="vibe-field" data-vibe-component="field" htmlFor={fieldId}>
      <span className="vibe-field__label">{label}</span>
      <select className="vibe-field__input" id={fieldId} {...selectProps}>
        {children}
      </select>
    </label>
  );
}

interface VibeTextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "id"> {
  fieldId: string;
  label: string;
}

export function VibeTextAreaField({
  fieldId,
  label,
  ...textareaProps
}: VibeTextAreaFieldProps) {
  return (
    <label className="vibe-field" data-vibe-component="field" htmlFor={fieldId}>
      <span className="vibe-field__label">{label}</span>
      <textarea className="vibe-field__input" id={fieldId} {...textareaProps} />
    </label>
  );
}
