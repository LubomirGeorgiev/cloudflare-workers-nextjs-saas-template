-- Seed file for development database
-- This file contains test data for local development

-- Insert test users (admin and regular users for development)
-- Password for all users: test123
INSERT OR REPLACE INTO user (
  id,
  createdAt,
  updatedAt,
  updateCounter,
  firstName,
  lastName,
  email,
  passwordHash,
  role,
  emailVerified,
  signUpIpAddress,
  googleAccountId,
  avatar,
  currentCredits,
  lastCreditRefreshAt
)
VALUES
  -- Admin user
  (
    'usr_lyo1up6a9q75dmpv3o5x9irj',
    1767305206,
    1767525200,
    6,
    'Test',
    'Testov',
    'test@test.com',
    -- The password is "password"
    'e8e1ab2aedb0451c4351c733969d8b71:97f4d96d92689e1f4e48e6b3b2dec890dcb8f0c2d2e0e12b433bcafa38a8eebd',
    'admin',
    1767305213,
    '::1',
    NULL,
    NULL,
    0,
    1767305206
  ),
  -- Regular user 1: Sarah Chen
  (
    'usr_sarah_chen',
    1765305206,
    1767525200,
    3,
    'Sarah',
    'Chen',
    'sarah.chen@example.com',
    -- The password is "password"
    'e8e1ab2aedb0451c4351c733969d8b71:97f4d96d92689e1f4e48e6b3b2dec890dcb8f0c2d2e0e12b433bcafa38a8eebd',
    'user',
    1765305213,
    '::1',
    NULL,
    NULL,
    0,
    1765305206
  ),
  -- Regular user 2: Michael Rodriguez
  (
    'usr_michael_rod',
    1764305206,
    1767525200,
    2,
    'Michael',
    'Rodriguez',
    'michael.rodriguez@example.com',
    -- The password is "password"
    'e8e1ab2aedb0451c4351c733969d8b71:97f4d96d92689e1f4e48e6b3b2dec890dcb8f0c2d2e0e12b433bcafa38a8eebd',
    'user',
    1764305213,
    '::1',
    NULL,
    NULL,
    0,
    1764305206
  );

-- Insert 20 blog posts for testing pagination (distributed across 3 authors with varying dates)
INSERT INTO cms_entry (id, collection, title, content, fields, slug, seoDescription, status, publishedAt, createdBy, createdAt, updatedAt, updateCounter)
VALUES
  -- Recent posts (last 2 weeks) by Test Testov
  ('cms_ent_test001', 'blog', 'Getting Started with Next.js 15', '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","marks":[{"type":"highlight","attrs":{"color":"var(--tt-color-highlight-yellow)"}}],"text":"Next.js 15"},{"type":"text","text":" gives you a "},{"type":"text","marks":[{"type":"bold"}],"text":"fast starting point"},{"type":"text","text":" for production apps. In this guide, we will cover the "},{"type":"text","marks":[{"type":"italic"}],"text":"core workflow"},{"type":"text","text":" for building and shipping a modern app, plus a few "},{"type":"text","marks":[{"type":"underline"}],"text":"practical habits"},{"type":"text","text":" that help teams move quickly."}]},{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"If you want release notes and migration details, start with the "},{"type":"text","marks":[{"type":"link","attrs":{"href":"https://nextjs.org/blog","target":"_blank","rel":"noopener noreferrer nofollow","class":null}}],"text":"official Next.js blog"},{"type":"text","text":"."}]},{"type":"heading","attrs":{"textAlign":null,"level":1},"content":[{"type":"text","text":"Build Your First Next.js 15 Page"}]},{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"A good first step is setting up your root layout and font loading so every page inherits consistent typography and HTML metadata defaults."}]},{"type":"codeBlock","attrs":{"language":"typescript"},"content":[{"type":"text","text":"import { Inter } from ''next/font/google''\n\nconst inter = Inter({\n  subsets: [''latin''],\n  display: ''swap'',\n})\n\nexport default function RootLayout({\n  children,\n}: {\n  children: React.ReactNode\n}) {\n  return (\n    <html lang=\"en\" className={inter.className}>\n      <body>{children}</body>\n    </html>\n  )\n}"}]},{"type":"heading","attrs":{"textAlign":null,"level":2},"content":[{"type":"text","text":"What to Learn First"}]},{"type":"orderedList","attrs":{"start":1,"type":null},"content":[{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Routing with the App Router (layouts, nested routes, and loading states)."}]}]},{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Server Components vs Client Components and when to use each."}]}]},{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Data fetching patterns and caching behavior in production."}]}]}]},{"type":"heading","attrs":{"textAlign":null,"level":3},"content":[{"type":"text","text":"Starter Project Checklist"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Create a landing page and a protected dashboard route."}]}]},{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Add authentication before building advanced features."}]}]},{"type":"listItem","content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Measure performance early so regressions are visible."}]}]}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Scaffold the app and verify local development runs."}]}]},{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Add a database-backed feature (posts, comments, or billing records)."}]}]},{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Deploy to an edge runtime and test real production behavior."}]}]}]},{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Avoid the temptation to "},{"type":"text","marks":[{"type":"strike"}],"text":"optimize everything on day one"},{"type":"text","text":". Ship a small vertical slice, then improve with real usage data."}]},{"type":"horizontalRule"},{"type":"paragraph","attrs":{"textAlign":"left"},"content":[{"type":"text","text":"Left aligned note: keep server logic close to the route that owns it."}]},{"type":"paragraph","attrs":{"textAlign":"center"},"content":[{"type":"text","text":"Center aligned takeaway: start simple, measure, then scale."}]},{"type":"paragraph","attrs":{"textAlign":"right"},"content":[{"type":"text","text":"Right aligned reminder: production is the real benchmark."}]},{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Performance often feels nonlinear: a "},{"type":"text","marks":[{"type":"superscript"}],"text":"2"},{"type":"text","text":"x improvement in a bottleneck can unlock much larger UX gains."}]},{"type":"paragraph","attrs":{"textAlign":null},"content":[{"type":"text","text":"Think in layers: cache at the edge, stream what you can, and keep the "},{"type":"text","marks":[{"type":"subscript"}],"text":"critical"},{"type":"text","text":" path small."}]}]}', '{}', 'getting-started-with-nextjs-15', 'A comprehensive guide to getting started with Next.js 15', 'published', 1736467200, 'usr_lyo1up6a9q75dmpv3o5x9irj', 1736467200, 1736467200, 0),

  ('cms_ent_test002', 'blog', 'Mastering React Server Components', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Dive deep into React Server Components and understand how they revolutionize web development."}]}]}', '{}', 'mastering-react-server-components', 'Everything you need to know about React Server Components', 'published', 1736294400, 'usr_sarah_chen', 1736294400, 1736294400, 0),

  ('cms_ent_test003', 'blog', 'Building Scalable APIs with Cloudflare Workers', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Discover how to build high-performance, globally distributed APIs using Cloudflare Workers."}]}]}', '{}', 'building-scalable-apis-cloudflare-workers', 'Learn to build scalable APIs with Cloudflare Workers', 'published', 1736121600, 'usr_michael_rod', 1736121600, 1736121600, 0),

  ('cms_ent_test004', 'blog', 'TypeScript Best Practices for 2026', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Explore the latest TypeScript best practices and patterns for writing maintainable code."}]}]}', '{}', 'typescript-best-practices-2026', 'Modern TypeScript best practices and patterns', 'published', 1735948800, 'usr_lyo1up6a9q75dmpv3o5x9irj', 1735948800, 1735948800, 0),

  -- Posts from 1-2 months ago
  ('cms_ent_test005', 'blog', 'Optimizing Web Performance with Edge Computing', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Learn how edge computing can dramatically improve your web application performance."}]}]}', '{}', 'optimizing-web-performance-edge-computing', 'Improve web performance with edge computing strategies', 'published', 1735776000, 'usr_sarah_chen', 1735776000, 1735776000, 0),

  ('cms_ent_test006', 'blog', 'Database Design Patterns for SaaS Applications', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Essential database design patterns every SaaS developer should know."}]}]}', '{}', 'database-design-patterns-saas', 'Database design patterns for building SaaS applications', 'published', 1735603200, 'usr_michael_rod', 1735603200, 1735603200, 0),

  ('cms_ent_test007', 'blog', 'Authentication Strategies for Modern Web Apps', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Compare different authentication strategies and choose the right one for your application."}]}]}', '{}', 'authentication-strategies-modern-web-apps', 'A guide to authentication strategies for web applications', 'published', 1735430400, 'usr_lyo1up6a9q75dmpv3o5x9irj', 1735430400, 1735430400, 0),

  ('cms_ent_test008', 'blog', 'Implementing Real-time Features with WebSockets', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Build real-time collaborative features using WebSockets and modern web technologies."}]}]}', '{}', 'implementing-realtime-features-websockets', 'Learn to implement real-time features with WebSockets', 'published', 1735257600, 'usr_sarah_chen', 1735257600, 1735257600, 0),

  ('cms_ent_test009', 'blog', 'CSS Grid vs Flexbox: When to Use Each', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Understand the differences between CSS Grid and Flexbox and when to use each layout system."}]}]}', '{}', 'css-grid-vs-flexbox-when-to-use', 'CSS Grid vs Flexbox comparison and use cases', 'published', 1735084800, 'usr_michael_rod', 1735084800, 1735084800, 0),

  ('cms_ent_test010', 'blog', 'Serverless Architecture Patterns', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Explore common serverless architecture patterns and their real-world applications."}]}]}', '{}', 'serverless-architecture-patterns', 'Common serverless architecture patterns explained', 'published', 1734912000, 'usr_lyo1up6a9q75dmpv3o5x9irj', 1734912000, 1734912000, 0),

  -- Posts from 2-3 months ago
  ('cms_ent_test011', 'blog', 'Testing Strategies for React Applications', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Comprehensive guide to testing React applications with modern tools and best practices."}]}]}', '{}', 'testing-strategies-react-applications', 'Testing strategies and best practices for React apps', 'published', 1734739200, 'usr_sarah_chen', 1734739200, 1734739200, 0),

  ('cms_ent_test012', 'blog', 'Building a Design System from Scratch', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Step-by-step guide to creating a scalable and maintainable design system."}]}]}', '{}', 'building-design-system-from-scratch', 'How to build a design system from the ground up', 'published', 1734566400, 'usr_michael_rod', 1734566400, 1734566400, 0),

  ('cms_ent_test013', 'blog', 'Advanced Git Workflows for Teams', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Master advanced Git workflows to improve team collaboration and code quality."}]}]}', '{}', 'advanced-git-workflows-teams', 'Advanced Git workflows for better team collaboration', 'published', 1734393600, 'usr_lyo1up6a9q75dmpv3o5x9irj', 1734393600, 1734393600, 0),

  ('cms_ent_test014', 'blog', 'Microservices vs Monoliths: Making the Right Choice', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Compare microservices and monolithic architectures to make informed decisions."}]}]}', '{}', 'microservices-vs-monoliths-right-choice', 'Microservices vs monoliths: architecture comparison', 'published', 1734220800, 'usr_sarah_chen', 1734220800, 1734220800, 0),

  ('cms_ent_test015', 'blog', 'SEO Best Practices for Single Page Applications', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Learn how to optimize SPAs for search engines and improve your visibility."}]}]}', '{}', 'seo-best-practices-single-page-apps', 'SEO optimization strategies for single page applications', 'published', 1734048000, 'usr_michael_rod', 1734048000, 1734048000, 0),

  -- Older posts (3-4 months ago)
  ('cms_ent_test016', 'blog', 'State Management in Modern React', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Explore different state management solutions and choose the right one for your needs."}]}]}', '{}', 'state-management-modern-react', 'Modern state management approaches in React', 'published', 1733875200, 'usr_lyo1up6a9q75dmpv3o5x9irj', 1733875200, 1733875200, 0),

  ('cms_ent_test017', 'blog', 'Securing Your Web Application', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Essential security practices to protect your web application from common vulnerabilities."}]}]}', '{}', 'securing-your-web-application', 'Web application security best practices and tips', 'published', 1733702400, 'usr_sarah_chen', 1733702400, 1733702400, 0),

  ('cms_ent_test018', 'blog', 'GraphQL vs REST: A Practical Comparison', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Understand the differences between GraphQL and REST APIs with practical examples."}]}]}', '{}', 'graphql-vs-rest-practical-comparison', 'GraphQL vs REST: which API architecture is right for you', 'published', 1733529600, 'usr_michael_rod', 1733529600, 1733529600, 0),

  ('cms_ent_test019', 'blog', 'Monitoring and Observability for Production Apps', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Set up comprehensive monitoring and observability for your production applications."}]}]}', '{}', 'monitoring-observability-production-apps', 'Monitoring and observability strategies for production', 'published', 1733356800, 'usr_lyo1up6a9q75dmpv3o5x9irj', 1733356800, 1733356800, 0),

  ('cms_ent_test020', 'blog', 'Building Progressive Web Apps in 2026', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Create engaging progressive web apps with modern web capabilities and offline support."}]}]}', '{}', 'building-progressive-web-apps-2026', 'Guide to building progressive web apps with modern features', 'published', 1733184000, 'usr_sarah_chen', 1733184000, 1733184000, 0);

-- Insert blog tags (created by different users)
INSERT INTO cms_tag (id, name, slug, description, color, createdBy, createdAt, updatedAt, updateCounter)
VALUES
  ('ctag_test001', 'Next.js', 'nextjs', 'Articles about Next.js framework', '#000000', 'usr_lyo1up6a9q75dmpv3o5x9irj', 1733184000, 1733184000, 0),
  ('ctag_test002', 'React', 'react', 'React library and ecosystem', '#61DAFB', 'usr_lyo1up6a9q75dmpv3o5x9irj', 1733184000, 1733184000, 0),
  ('ctag_test003', 'TypeScript', 'typescript', 'TypeScript language and best practices', '#3178C6', 'usr_sarah_chen', 1733270400, 1733270400, 0),
  ('ctag_test004', 'Cloudflare', 'cloudflare', 'Cloudflare Workers and edge computing', '#F38020', 'usr_michael_rod', 1733356800, 1733356800, 0),
  ('ctag_test005', 'Performance', 'performance', 'Web performance optimization', '#10B981', 'usr_sarah_chen', 1733443200, 1733443200, 0),
  ('ctag_test006', 'Database', 'database', 'Database design and optimization', '#8B5CF6', 'usr_michael_rod', 1733529600, 1733529600, 0),
  ('ctag_test007', 'Authentication', 'authentication', 'Auth strategies and security', '#EF4444', 'usr_lyo1up6a9q75dmpv3o5x9irj', 1733616000, 1733616000, 0),
  ('ctag_test008', 'CSS', 'css', 'CSS styling and layout techniques', '#1572B6', 'usr_sarah_chen', 1733702400, 1733702400, 0),
  ('ctag_test009', 'Serverless', 'serverless', 'Serverless architecture patterns', '#FD5750', 'usr_michael_rod', 1733788800, 1733788800, 0),
  ('ctag_test010', 'Testing', 'testing', 'Testing strategies and tools', '#F59E0B', 'usr_sarah_chen', 1733875200, 1733875200, 0),
  ('ctag_test011', 'Design Systems', 'design-systems', 'Building and maintaining design systems', '#EC4899', 'usr_lyo1up6a9q75dmpv3o5x9irj', 1733961600, 1733961600, 0),
  ('ctag_test012', 'Git', 'git', 'Version control with Git', '#F05032', 'usr_michael_rod', 1734048000, 1734048000, 0),
  ('ctag_test013', 'Architecture', 'architecture', 'Software architecture patterns', '#6366F1', 'usr_sarah_chen', 1734134400, 1734134400, 0),
  ('ctag_test014', 'SEO', 'seo', 'Search engine optimization', '#14B8A6', 'usr_lyo1up6a9q75dmpv3o5x9irj', 1734220800, 1734220800, 0),
  ('ctag_test015', 'State Management', 'state-management', 'Managing application state', '#A855F7', 'usr_michael_rod', 1734307200, 1734307200, 0),
  ('ctag_test016', 'Security', 'security', 'Web security best practices', '#DC2626', 'usr_sarah_chen', 1734393600, 1734393600, 0),
  ('ctag_test017', 'API', 'api', 'API design and development', '#06B6D4', 'usr_lyo1up6a9q75dmpv3o5x9irj', 1734480000, 1734480000, 0),
  ('ctag_test018', 'Monitoring', 'monitoring', 'Application monitoring and observability', '#84CC16', 'usr_michael_rod', 1734566400, 1734566400, 0),
  ('ctag_test019', 'PWA', 'pwa', 'Progressive Web Apps', '#5A67D8', 'usr_sarah_chen', 1734652800, 1734652800, 0);

-- Link tags to blog posts (each post gets 2-3 relevant tags)
INSERT INTO cms_entry_tag (id, entryId, tagId, createdAt, updatedAt, updateCounter)
VALUES
  -- Post 1: Getting Started with Next.js 15
  ('cet_test001', 'cms_ent_test001', 'ctag_test001', 1736467200, 1736467200, 0),
  ('cet_test002', 'cms_ent_test001', 'ctag_test002', 1736467200, 1736467200, 0),
  ('cet_test003', 'cms_ent_test001', 'ctag_test003', 1736467200, 1736467200, 0),

  -- Post 2: Mastering React Server Components
  ('cet_test004', 'cms_ent_test002', 'ctag_test002', 1736294400, 1736294400, 0),
  ('cet_test005', 'cms_ent_test002', 'ctag_test001', 1736294400, 1736294400, 0),

  -- Post 3: Building Scalable APIs with Cloudflare Workers
  ('cet_test006', 'cms_ent_test003', 'ctag_test004', 1736121600, 1736121600, 0),
  ('cet_test007', 'cms_ent_test003', 'ctag_test009', 1736121600, 1736121600, 0),
  ('cet_test008', 'cms_ent_test003', 'ctag_test017', 1736121600, 1736121600, 0),

  -- Post 4: TypeScript Best Practices for 2026
  ('cet_test009', 'cms_ent_test004', 'ctag_test003', 1735948800, 1735948800, 0),

  -- Post 5: Optimizing Web Performance with Edge Computing
  ('cet_test010', 'cms_ent_test005', 'ctag_test005', 1735776000, 1735776000, 0),
  ('cet_test011', 'cms_ent_test005', 'ctag_test004', 1735776000, 1735776000, 0),

  -- Post 6: Database Design Patterns for SaaS Applications
  ('cet_test012', 'cms_ent_test006', 'ctag_test006', 1735603200, 1735603200, 0),
  ('cet_test013', 'cms_ent_test006', 'ctag_test013', 1735603200, 1735603200, 0),

  -- Post 7: Authentication Strategies for Modern Web Apps
  ('cet_test014', 'cms_ent_test007', 'ctag_test007', 1735430400, 1735430400, 0),
  ('cet_test015', 'cms_ent_test007', 'ctag_test016', 1735430400, 1735430400, 0),

  -- Post 8: Implementing Real-time Features with WebSockets
  ('cet_test016', 'cms_ent_test008', 'ctag_test002', 1735257600, 1735257600, 0),
  ('cet_test017', 'cms_ent_test008', 'ctag_test017', 1735257600, 1735257600, 0),

  -- Post 9: CSS Grid vs Flexbox: When to Use Each
  ('cet_test018', 'cms_ent_test009', 'ctag_test008', 1735084800, 1735084800, 0),

  -- Post 10: Serverless Architecture Patterns
  ('cet_test019', 'cms_ent_test010', 'ctag_test009', 1734912000, 1734912000, 0),
  ('cet_test020', 'cms_ent_test010', 'ctag_test013', 1734912000, 1734912000, 0),
  ('cet_test021', 'cms_ent_test010', 'ctag_test004', 1734912000, 1734912000, 0),

  -- Post 11: Testing Strategies for React Applications
  ('cet_test022', 'cms_ent_test011', 'ctag_test010', 1734739200, 1734739200, 0),
  ('cet_test023', 'cms_ent_test011', 'ctag_test002', 1734739200, 1734739200, 0),

  -- Post 12: Building a Design System from Scratch
  ('cet_test024', 'cms_ent_test012', 'ctag_test011', 1734566400, 1734566400, 0),
  ('cet_test025', 'cms_ent_test012', 'ctag_test008', 1734566400, 1734566400, 0),

  -- Post 13: Advanced Git Workflows for Teams
  ('cet_test026', 'cms_ent_test013', 'ctag_test012', 1734393600, 1734393600, 0),

  -- Post 14: Microservices vs Monoliths: Making the Right Choice
  ('cet_test027', 'cms_ent_test014', 'ctag_test013', 1734220800, 1734220800, 0),

  -- Post 15: SEO Best Practices for Single Page Applications
  ('cet_test028', 'cms_ent_test015', 'ctag_test014', 1734048000, 1734048000, 0),
  ('cet_test029', 'cms_ent_test015', 'ctag_test002', 1734048000, 1734048000, 0),

  -- Post 16: State Management in Modern React
  ('cet_test030', 'cms_ent_test016', 'ctag_test015', 1733875200, 1733875200, 0),
  ('cet_test031', 'cms_ent_test016', 'ctag_test002', 1733875200, 1733875200, 0),

  -- Post 17: Securing Your Web Application
  ('cet_test032', 'cms_ent_test017', 'ctag_test016', 1733702400, 1733702400, 0),

  -- Post 18: GraphQL vs REST: A Practical Comparison
  ('cet_test033', 'cms_ent_test018', 'ctag_test017', 1733529600, 1733529600, 0),

  -- Post 19: Monitoring and Observability for Production Apps
  ('cet_test034', 'cms_ent_test019', 'ctag_test018', 1733356800, 1733356800, 0),

  -- Post 20: Building Progressive Web Apps in 2026
  ('cet_test035', 'cms_ent_test020', 'ctag_test019', 1733184000, 1733184000, 0),
  ('cet_test036', 'cms_ent_test020', 'ctag_test002', 1733184000, 1733184000, 0);
