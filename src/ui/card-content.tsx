import ReactMarkdown from "react-markdown";

import type { Card } from "@/server/ports";

function MarkdownBody({ source }: { source: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        skipHtml
        components={{
          a: (properties) => (
            <a {...properties} target="_blank" rel="noreferrer" />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export function CardContent({ card }: { card: Card }) {
  switch (card.kind) {
    case "identity":
      return (
        <>
          <p className="card-label">身份</p>
          <div className="identity-content">
            {card.avatarUrl ? (
              // 头像仅接受 http(s) URL；浏览器不会收到私密卡片的该字段。
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="identity-avatar"
                src={card.avatarUrl}
                alt={`${card.nickname}的头像`}
                referrerPolicy="no-referrer"
              />
            ) : null}
            <div>
              <h2 className="identity-name">{card.nickname}</h2>
              <p className="card-body">{card.introduction}</p>
            </div>
          </div>
        </>
      );
    case "now":
      return (
        <>
          <p className="card-label">Now</p>
          <p className="card-body">{card.content}</p>
        </>
      );
    case "links":
      return (
        <>
          <p className="card-label">链接</p>
          <ul className="links-list">
            {card.links.map((link) => (
              <li key={`${link.label}-${link.url}`}>
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      );
    case "markdown":
      return (
        <>
          <p className="card-label">{card.title}</p>
          <MarkdownBody source={card.markdown} />
        </>
      );
    case "asset":
      return (
        <>
          <p className="card-label">{card.title}</p>
          <p className="card-body">{card.body}</p>
        </>
      );
  }
}
