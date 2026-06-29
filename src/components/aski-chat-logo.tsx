export function AskiChatLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="128"
      height="128"
      viewBox="0 0 128 128"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <defs>
        <linearGradient
          id="aski-chat-logo-bubble-gradient"
          x1="14"
          x2="112"
          y1="10"
          y2="110"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#16C7D4" />
          <stop offset="0.52" stopColor="#13B8A6" />
          <stop offset="1" stopColor="#4ADE80" />
        </linearGradient>
        <linearGradient
          id="aski-chat-logo-sparkle-gradient"
          x1="86"
          x2="107"
          y1="35"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#F8FAFC" />
          <stop offset="1" stopColor="#D1FAE5" />
        </linearGradient>
      </defs>

      <path
        fill="url(#aski-chat-logo-bubble-gradient)"
        d="M16 58.5C16 33.923 35.923 14 60.5 14h17C102.077 14 122 33.923 122 58.5S102.077 103 77.5 103H75.5l-24.8 18.6c-3.02 2.265-7.3.11-7.3-3.665v-17.86C27.581 93.461 16 78.413 16 58.5Z"
      />
      <path
        fill="#FFFFFF"
        transform="translate(69 60) scale(1.12) translate(-65.5 -53)"
        d="M43.027 70 60.165 35.956c2.198-4.367 8.442-4.367 10.64 0L87.947 70H76.68l-2.919-6.32H57.209L54.295 70H43.027Zm17.748-14h9.45L65.5 45.779 60.775 56Z"
      />
      <path
        fill="url(#aski-chat-logo-sparkle-gradient)"
        transform="translate(4 -5)"
        d="M91.327 40.362c.524-1.59 2.772-1.59 3.296 0l1.755 5.323a1.74 1.74 0 0 0 1.109 1.109l5.323 1.755c1.59.524 1.59 2.772 0 3.296L97.487 53.6a1.74 1.74 0 0 0-1.109 1.109l-1.755 5.323c-.524 1.59-2.772 1.59-3.296 0l-1.755-5.323a1.74 1.74 0 0 0-1.109-1.109l-5.323-1.755c-1.59-.524-1.59-2.772 0-3.296l5.323-1.755a1.74 1.74 0 0 0 1.109-1.109l1.755-5.323Z"
      />
    </svg>
  );
}
