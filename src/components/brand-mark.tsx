type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="9" fill="#1F2348" />
      <ellipse
        cx="16"
        cy="16"
        rx="11"
        ry="6.25"
        transform="rotate(-28 16 16)"
        stroke="#E9B213"
        strokeWidth="1.4"
        opacity="0.78"
      />
      <path
        d="M9.5 22V10h3.35l6.3 7.18V10h3.35v12h-3.35l-6.3-7.18V22H9.5Z"
        fill="#E9B213"
      />
      <circle cx="24.1" cy="9.1" r="1.45" fill="#F7D66B" />
    </svg>
  );
}
