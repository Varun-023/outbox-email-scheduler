import { Client } from '@elastic/elasticsearch';

export function createElasticsearchClient(url: string): Client {
  return new Client({ node: url, requestTimeout: 5_000, maxRetries: 1 });
}

export async function pingElasticsearch(client: Client): Promise<void> {
  const reachable = await client.ping();
  if (!reachable) {
    throw new Error('Elasticsearch ping returned a non-success status');
  }
}
