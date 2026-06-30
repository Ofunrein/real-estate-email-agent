create extension if not exists vector;

create table if not exists property_embeddings (
  client_id text not null,
  address text not null,
  embedding_model text not null,
  embedding_text_hash text not null,
  embedding_text text not null default '',
  embedding vector(1536) not null,
  updated_at timestamptz not null default now(),
  primary key (client_id, address, embedding_model),
  foreign key (client_id, address)
    references properties(client_id, address)
    on delete cascade
);

create index if not exists property_embeddings_vector_hnsw_idx
  on property_embeddings
  using hnsw (embedding vector_cosine_ops);

create index if not exists property_embeddings_client_model_idx
  on property_embeddings (client_id, embedding_model, updated_at desc);
