{{- define "pehle.name" -}}pehle-aap{{- end -}}
{{- define "pehle.labels" -}}
app.kubernetes.io/name: {{ include "pehle.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
{{- end -}}
{{- define "pehle.selector" -}}
app.kubernetes.io/name: {{ include "pehle.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
