import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export const MarkdownAnswer=React.memo(function MarkdownAnswer({text}:{text:string}):React.JSX.Element{
 return <div className="markdown-body"><Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
  a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
  // Model output must not automatically fetch arbitrary remote images.
  img:({alt})=><span>{alt?'[图片：'+alt+']':'[图片]'}</span>
 }}>{text}</Markdown></div>;
});
