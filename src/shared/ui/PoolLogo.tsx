import { useState } from 'react'

type PoolLogoProps = {
  className: string
  logoUrl: string | null
  fallback: string
  alt: string
}

function PoolLogo({ className, logoUrl, fallback, alt }: PoolLogoProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = Boolean(logoUrl) && !imageFailed

  return (
    <span className={className}>
      {showImage ? (
        <img
          src={logoUrl ?? ''}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        fallback
      )}
    </span>
  )
}

export default PoolLogo
