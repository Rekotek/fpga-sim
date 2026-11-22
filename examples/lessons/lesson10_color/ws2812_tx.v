// Урок 10: передатчик WS2812 — один кадр из 24 бит (G, R, B; старший бит первым).
// Бит кодируется длительностью высокого уровня: «0» — короткий импульс,
// «1» — длинный. После 24 бит линия держится в 0 не меньше 300 мкс (reset):
// светодиод защёлкивает принятый цвет. По импульсу start берёт r, g, b.
// Пока идёт кадр и пауза, busy = 1 и новые start не принимаются.
module ws2812_tx #(
    parameter integer CLK_HZ = 27_000_000   // частота clk, кратна 1 МГц
) (
    input  wire       clk,
    input  wire       start,    // 1 на такт (или постоянно): «отправь цвет»
    input  wire [7:0] r,        // красный 0..255
    input  wire [7:0] g,        // зелёный 0..255
    input  wire [7:0] b,        // синий 0..255
    output reg        dout = 1'b0,  // линия данных WS2812: в покое 0
    output wire       busy      // 1, пока идёт кадр и пауза
);
    // Длительности в тактах: число наносекунд × (тактов в микросекунде) / 1000.
    localparam integer MHZ      = CLK_HZ / 1_000_000;     // 27 тактов в 1 мкс
    localparam integer T0H      = MHZ * 350 / 1000;       // «0»: 9 тактов = 333 нс
    localparam integer T1H      = MHZ * 800 / 1000;       // «1»: 21 такт = 778 нс
    localparam integer BIT_LAST = MHZ * 1300 / 1000 - 1;  // бит: 35 тактов = 1,3 мкс
    localparam integer RES_LAST = MHZ * 300 - 1;          // пауза: 8100 тактов = 300 мкс

    localparam [1:0] S_IDLE  = 2'd0,    // ждём start
                     S_BIT   = 2'd1,    // 24 бита, старший первым
                     S_RESET = 2'd2;    // линия в 0: светодиод защёлкивает цвет

    reg [1:0]  state = S_IDLE;
    reg [1:0]  next;            // НЕ регистр: присваивается в always @(*)
    reg        line;            // НЕ регистр: что должно быть на линии сейчас
    reg [12:0] div = 13'd0;     // таймер: 0..BIT_LAST в бите, 0..RES_LAST в паузе
    reg [4:0]  n   = 5'd0;      // номер бита: 0..23
    reg [23:0] sr  = 24'd0;     // сдвиговый регистр: sr[23] — бит на линии

    wire bit_end = (state == S_BIT)   && (div == BIT_LAST);   // последний такт бита
    wire res_end = (state == S_RESET) && (div == RES_LAST);   // последний такт паузы

    // Блок 1 — комбинационный: куда идти и что выдавать в линию.
    always @(*) begin
        next = state;
        line = 1'b0;                            // по умолчанию — 0
        case (state)
            S_IDLE:  if (start) next = S_BIT;
            S_BIT:   begin
                         // Высокий уровень в начале бита: короткий для 0, длинный для 1.
                         line = (div < (sr[23] ? T1H : T0H));
                         if (bit_end && n == 5'd23) next = S_RESET;
                     end
            S_RESET: if (res_end) next = S_IDLE;
            default: next = S_IDLE;
        endcase
    end

    // Блок 2 — тактовый.
    always @(posedge clk) begin
        state <= next;
        dout  <= line;                          // выход — из триггера: без «иголок»

        if (next != state || bit_end) div <= 13'd0;
        else                          div <= div + 1'b1;

        if (state == S_IDLE) begin
            n <= 5'd0;
            if (start) sr <= {g, r, b};         // порядок WS2812: G, R, B
        end else if (bit_end) begin
            n  <= n + 1'b1;
            sr <= {sr[22:0], 1'b0};             // сдвиг влево: следующий бит в sr[23]
        end
    end

    assign busy = (state != S_IDLE);
endmodule
