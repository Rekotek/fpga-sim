// Проверочная схема этапа 0 (не пример для пользователя): порты всех размеров,
// обратный и смещённый диапазон, знаковый порт, inout, имя с экранированием,
// вложенный модуль и память. По ней проверяются разбор Vtop.h, перечисление
// сигналов и то, что одна заранее собранная библиотека подходит другой модели.
module sub (
    input  wire       clk,
    input  wire [7:0] d,
    output reg  [7:0] r
);
    reg [7:0] mem [0:15];
    reg [3:0] wp = 0;
    always @(posedge clk) begin
        mem[wp] <= d;
        wp <= wp + 1'b1;
        r <= mem[wp];
    end
endmodule

module top (
    input  wire                clk,
    input  wire [7:0]          in8,
    input  wire [0:8]          in9_asc,
    input  wire [15:0]         in16,
    input  wire [32:0]         in33,
    input  wire signed [63:0]  in64s,
    input  wire [127:0]        in128,
    inout  wire                io1,
    output wire                out1,
    output wire [11:4]         out8_off,
    output reg  [16:0]         out17,
    output wire [31:0]         out32,
    output reg  [64:0]         out65,
    output wire [7:0]          \bus-a
);
    reg [64:0] cnt = 0;

    always @(posedge clk) begin
        cnt <= cnt + 1'b1;
        out65 <= cnt;
        out17 <= cnt[16:0] ^ {1'b0, in16};
    end

    assign out1 = ^in128 ^ ^in33 ^ in64s[63] ^ in9_asc[0] ^ io1;
    assign out8_off = in8;
    assign out32 = cnt[31:0];

    sub u_sub (.clk(clk), .d(cnt[7:0]), .r(\bus-a ));
endmodule
