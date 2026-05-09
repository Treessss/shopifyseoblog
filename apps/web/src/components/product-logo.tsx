export function ProductLogo(props: { size?: number; title?: string }) {
  const size = props.size ?? 40;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={props.title ?? "Shopify AI Blog"}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="48" height="48" rx="10" fill="url(#logo-bg)" />
      <path d="M15 14.5h12.5c3.3 0 6 2.7 6 6v13H20.5c-3.3 0-6-2.7-6-6v-13Z" fill="white" fillOpacity="0.96" />
      <path d="M20 20h9.5M20 25h13M20 30h7.5" stroke="#0071E3" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M34.8 14.5l1.1 2.7 2.7 1.1-2.7 1.1-1.1 2.7-1.1-2.7-2.7-1.1 2.7-1.1 1.1-2.7Z" fill="#34C759" />
      <path d="M32.5 31.5h4.8c1.2 0 2.2 1 2.2 2.2v4.8h-4.8c-1.2 0-2.2-1-2.2-2.2v-4.8Z" fill="#171717" fillOpacity="0.9" />
      <path d="M35.9 34.2v2.9M34.5 35.7h2.9" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <defs>
        <linearGradient id="logo-bg" x1="7" x2="42" y1="5" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0A84FF" />
          <stop offset="0.62" stopColor="#0071E3" />
          <stop offset="1" stopColor="#34C759" />
        </linearGradient>
      </defs>
    </svg>
  );
}
