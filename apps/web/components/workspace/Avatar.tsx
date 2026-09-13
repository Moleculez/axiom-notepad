"use client";
import { useState } from "react";
import { initials } from "../../lib/client";
export default function Avatar({
  person,
  className = "",
}: {
  person: { name: string; image?: string | null };
  className?: string;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = person.image?.startsWith("/api/v1/people/")
    ? person.image
    : null;
  return (
    <span className={`ws-avatar ${className}`.trim()}>
      {image && image !== failedImage ? (
        <img
          key={image}
          src={image}
          alt=""
          onError={() => setFailedImage(image)}
          onLoad={() => setFailedImage(null)}
        />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}
