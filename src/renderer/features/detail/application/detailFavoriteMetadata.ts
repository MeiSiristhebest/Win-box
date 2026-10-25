export interface DetailFavoriteMetadata {
  profileId: string;
  sourceName: string;
}

export interface DetailFavoriteMetadataPort {
  load(sourceKey: string, requestedProfileId: string): Promise<DetailFavoriteMetadata>;
}
