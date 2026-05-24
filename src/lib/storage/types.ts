export type ImageData = {
  id: string;
  title: string;
  url_viewer: string;
  url: string;
  display_url: string;
  width: string;
  height: string;
  size: number;
  time: string;
  expiration: string;
  image: {
    filename: string;
    name: string;
    mime: string;
    extension: string;
    url: string;
  };
  thumb: {
    filename: string;
    name: string;
    mime: string;
    extension: string;
    url: string;
  };
  medium: {
    filename: string;
    name: string;
    mime: string;
    extension: string;
    url: string;
  };
  delete_url: string;
};

export type ImgBBUploadRequest = {
  key: string;
  image: string | Buffer;
  name?: string;
  expiration?: number;
};

export type ImgBBUploadResponse = {
  data: ImageData;
  success: boolean;
  status: number;
};

export type ImgBBDeleteRequest = {
  key: string;
  image_id: string;
};
