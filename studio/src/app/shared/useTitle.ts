import { useEffect } from 'react'

/** `<title>` of each page: « <Écran> · EVP ». */
export function useTitle(screen: string) {
  useEffect(() => {
    document.title = `${screen} · EVP`
  }, [screen])
}
